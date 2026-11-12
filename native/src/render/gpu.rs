//! Direct3D 11 fill: the same meshes and the same shaders as the WebGL renderer (ported to HLSL),
//! drawn with 4x MSAA into an offscreen target and read back into the frame. The CPU keeps the
//! geometry (`Renderer::prepare`), so behaviour and picking are unchanged; only the pixel work moves.
use super::raster::{Frame, Target};
use super::{Renderer, Draw, Layer};
use crate::motion::small::{eye_frame, eye_style};
use crate::motion::Pose;
use windows::core::{s, PCSTR};
use windows::Win32::Foundation::{HMODULE, RECT};
use windows::Win32::Graphics::Direct3D::Fxc::D3DCompile;
use windows::Win32::Graphics::Direct3D::*;
use windows::Win32::Graphics::Direct3D11::*;
use windows::Win32::Graphics::Dxgi::Common::*;

const HLSL: &str = r#"
cbuffer Place : register(b0) { float4 place; float4 target; };
cbuffer Layer : register(b1) { float4 u0; float4 crop; float4 eye; float4 lidShape; float4 u4; float4 u5; };
// u0 = opacity, eyeOpen, aa, irisGate; u4 = lidMotion.xy, irisCorner, sideEye; u5 = eyeGaze.xy, glanceShape.xy
struct VSIn { float2 pos : POSITION; float2 uv : TEXCOORD0; };
struct PSIn { float4 pos : SV_Position; float2 tex : TEXCOORD0; };
PSIn vs(VSIn i) {
  PSIn o;
  float px = place.x + (i.pos.x + 1.0) * 0.5 * place.z;
  float py = place.y + (1.0 - i.pos.y) * 0.5 * place.z;
  o.pos = float4(px / target.x * 2.0 - 1.0, 1.0 - py / target.y * 2.0, 0.0, 1.0);
  o.tex = i.uv;
  return o;
}
Texture2D image : register(t0);
SamplerState samp : register(s0);
float4 ps(PSIn i) : SV_Target {
  float2 tex = i.tex;
  float4 color = image.Sample(samp, tex);
  float opacity = u0.x, eyeOpen = u0.y, aa = u0.z, irisGate = u0.w;
  float2 lidMotion = u4.xy; float irisCorner = u4.z, sideEye = u4.w;
  float2 eyeGaze = u5.xy, glanceShape = u5.zw;
  if (eyeOpen >= 0.0) {
    float2 p = crop.xy + tex * crop.zw - eye.xy;
    float cs = cos(eye.z), sn = sin(eye.z), xx = cs * p.x + sn * p.y, yy = -sn * p.x + cs * p.y;
    float2 local = float2(xx - eyeGaze.x, yy - eyeGaze.y);
    float2 source = eye.xy + float2(cs * local.x - sn * local.y, sn * local.x + cs * local.y);
    color = image.SampleGrad(samp, (source - crop.xy) / crop.zw, ddx(tex), ddy(tex));
    float r = lidShape.x, x = clamp(xx, -r, r), arc = lidShape.y * (1.0 - x * x / (r * r));
    float profile = 1.0 - irisCorner * min(1.0, xx * xx / (r * r));
    float top = arc - lidMotion.x * profile, bottom = arc + lidMotion.y * profile, e = max(0.0003, aa * 0.5);
    float mask = smoothstep(top - e, top + e, yy) * (1.0 - smoothstep(bottom - e, bottom + e, yy)) * irisGate
      * lerp(1.0, 1.0 - smoothstep(r - e, r + e, abs(xx)), irisCorner);
    color *= mask;
    float depth = max(glanceShape.y, 0.00001), ellipse = length(float2((xx - eyeGaze.x) / glanceShape.x, (yy - arc) / depth));
    float ellipseAA = e / min(glanceShape.x, depth);
    float glanceAlpha = (1.0 - smoothstep(1.0 - ellipseAA, 1.0 + ellipseAA, ellipse)) * smoothstep(top - e, top + e, yy) * irisGate;
    float3 glanceBlue = lerp(float3(0.0, 0.61, 0.89), float3(0.18, 0.77, 0.96), smoothstep(0.25, 1.0, (yy - arc) / depth));
    color = lerp(color, float4(glanceBlue * glanceAlpha, glanceAlpha), sideEye);
    float slope = -2.0 * x * (lidShape.y - lidMotion.x * irisCorner) / (r * r);
    float distanceToLid = length(float2(xx - x, (yy - top) / sqrt(1.0 + slope * slope)));
    float ink = (1.0 - smoothstep(lidShape.z - e, lidShape.z + e, distanceToLid)) * lidShape.w;
    color = float4(float3(0.10980392, 0.46666667, 0.75294118) * ink, ink) + color * (1.0 - ink);
  }
  return color * opacity;
}
"#;

#[repr(C)]
#[derive(Clone, Copy, Default)]
struct PlaceCb {
    place: [f32; 4],
    target: [f32; 4],
}
#[repr(C)]
#[derive(Clone, Copy, Default)]
struct LayerCb {
    v: [[f32; 4]; 6],
}

struct Targets {
    w: u32,
    h: u32,
    msaa: Option<ID3D11Texture2D>,
    resolved: ID3D11Texture2D,
    staging: ID3D11Texture2D,
    rtv: ID3D11RenderTargetView,
}

pub struct Gpu {
    device: ID3D11Device,
    ctx: ID3D11DeviceContext,
    vs: ID3D11VertexShader,
    ps: ID3D11PixelShader,
    layout: ID3D11InputLayout,
    blend: ID3D11BlendState,
    raster: ID3D11RasterizerState,
    sampler: ID3D11SamplerState,
    place_cb: ID3D11Buffer,
    layer_cb: ID3D11Buffer,
    vbuf: ID3D11Buffer,
    vcap: usize,
    textures: Vec<Option<ID3D11ShaderResourceView>>,
    samples: u32,
    targets: Option<Targets>,
}

fn compile(entry: PCSTR, target: PCSTR) -> Result<Vec<u8>, String> {
    unsafe {
        let mut code = None;
        let mut errors = None;
        let r = D3DCompile(HLSL.as_ptr() as *const _, HLSL.len(), PCSTR::null(), None, None, entry, target, 0, 0, &mut code, Some(&mut errors));
        if let Err(e) = r {
            let msg = errors
                .map(|b: windows::Win32::Graphics::Direct3D::ID3DBlob| String::from_utf8_lossy(std::slice::from_raw_parts(b.GetBufferPointer() as *const u8, b.GetBufferSize())).into_owned())
                .unwrap_or_default();
            return Err(format!("shader: {e} {msg}"));
        }
        let b = code.unwrap();
        Ok(std::slice::from_raw_parts(b.GetBufferPointer() as *const u8, b.GetBufferSize()).to_vec())
    }
}
fn err(e: windows::core::Error) -> String {
    e.to_string()
}

impl Gpu {
    /// A hardware device and every layer's texture; None when Direct3D 11 is unavailable.
    pub fn new(r: &Renderer) -> Result<Gpu, String> {
        unsafe {
            let mut device = None;
            let mut ctx = None;
            D3D11CreateDevice(
                None,
                D3D_DRIVER_TYPE_HARDWARE,
                HMODULE::default(),
                D3D11_CREATE_DEVICE_BGRA_SUPPORT | D3D11_CREATE_DEVICE_SINGLETHREADED,
                Some(&[D3D_FEATURE_LEVEL_11_0, D3D_FEATURE_LEVEL_10_1, D3D_FEATURE_LEVEL_10_0]),
                D3D11_SDK_VERSION,
                Some(&mut device),
                None,
                Some(&mut ctx),
            )
            .map_err(err)?;
            let (device, ctx): (ID3D11Device, ID3D11DeviceContext) = (device.unwrap(), ctx.unwrap());
            let vsb = compile(s!("vs"), s!("vs_4_0"))?;
            let psb = compile(s!("ps"), s!("ps_4_0"))?;
            let mut vs = None;
            device.CreateVertexShader(&vsb, None, Some(&mut vs)).map_err(err)?;
            let mut ps = None;
            device.CreatePixelShader(&psb, None, Some(&mut ps)).map_err(err)?;
            let elems = [
                D3D11_INPUT_ELEMENT_DESC { SemanticName: s!("POSITION"), Format: DXGI_FORMAT_R32G32_FLOAT, AlignedByteOffset: 0, InputSlotClass: D3D11_INPUT_PER_VERTEX_DATA, ..Default::default() },
                D3D11_INPUT_ELEMENT_DESC { SemanticName: s!("TEXCOORD"), Format: DXGI_FORMAT_R32G32_FLOAT, AlignedByteOffset: 8, InputSlotClass: D3D11_INPUT_PER_VERTEX_DATA, ..Default::default() },
            ];
            let mut layout = None;
            device.CreateInputLayout(&elems, &vsb, Some(&mut layout)).map_err(err)?;
            // Premultiplied "over": ONE, ONE_MINUS_SRC_ALPHA, as the WebGL renderer.
            let mut bd = D3D11_BLEND_DESC::default();
            bd.RenderTarget[0] = D3D11_RENDER_TARGET_BLEND_DESC {
                BlendEnable: true.into(),
                SrcBlend: D3D11_BLEND_ONE,
                DestBlend: D3D11_BLEND_INV_SRC_ALPHA,
                BlendOp: D3D11_BLEND_OP_ADD,
                SrcBlendAlpha: D3D11_BLEND_ONE,
                DestBlendAlpha: D3D11_BLEND_INV_SRC_ALPHA,
                BlendOpAlpha: D3D11_BLEND_OP_ADD,
                RenderTargetWriteMask: D3D11_COLOR_WRITE_ENABLE_ALL.0 as u8,
            };
            let mut blend = None;
            device.CreateBlendState(&bd, Some(&mut blend)).map_err(err)?;
            let rd = D3D11_RASTERIZER_DESC {
                FillMode: D3D11_FILL_SOLID,
                CullMode: D3D11_CULL_NONE,
                ScissorEnable: true.into(),
                MultisampleEnable: true.into(),
                DepthClipEnable: true.into(),
                ..Default::default()
            };
            let mut raster = None;
            device.CreateRasterizerState(&rd, Some(&mut raster)).map_err(err)?;
            let sd = D3D11_SAMPLER_DESC {
                Filter: D3D11_FILTER_ANISOTROPIC,
                AddressU: D3D11_TEXTURE_ADDRESS_CLAMP,
                AddressV: D3D11_TEXTURE_ADDRESS_CLAMP,
                AddressW: D3D11_TEXTURE_ADDRESS_CLAMP,
                MaxAnisotropy: 4,
                ComparisonFunc: D3D11_COMPARISON_NEVER,
                MaxLOD: f32::MAX,
                ..Default::default()
            };
            let mut sampler = None;
            device.CreateSamplerState(&sd, Some(&mut sampler)).map_err(err)?;
            let cb = |size: usize| -> Result<ID3D11Buffer, String> {
                let d = D3D11_BUFFER_DESC { ByteWidth: size as u32, Usage: D3D11_USAGE_DEFAULT, BindFlags: D3D11_BIND_CONSTANT_BUFFER.0 as u32, ..Default::default() };
                let mut b = None;
                device.CreateBuffer(&d, None, Some(&mut b)).map_err(err)?;
                Ok(b.unwrap())
            };
            let place_cb = cb(std::mem::size_of::<PlaceCb>())?;
            let layer_cb = cb(std::mem::size_of::<LayerCb>())?;
            let vcap = r.layers.iter().map(|l| l.data.len()).sum::<usize>() * 2;
            let vd = D3D11_BUFFER_DESC {
                ByteWidth: (vcap * 16) as u32,
                Usage: D3D11_USAGE_DYNAMIC,
                BindFlags: D3D11_BIND_VERTEX_BUFFER.0 as u32,
                CPUAccessFlags: D3D11_CPU_ACCESS_WRITE.0 as u32,
                ..Default::default()
            };
            let mut vbuf = None;
            device.CreateBuffer(&vd, None, Some(&mut vbuf)).map_err(err)?;
            let mut samples = 4;
            let q = device.CheckMultisampleQualityLevels(DXGI_FORMAT_B8G8R8A8_UNORM, 4).unwrap_or(0);
            if q == 0 {
                samples = 1;
            }
            let mut gpu = Gpu {
                device,
                ctx,
                vs: vs.unwrap(),
                ps: ps.unwrap(),
                layout: layout.unwrap(),
                blend: blend.unwrap(),
                raster: raster.unwrap(),
                sampler: sampler.unwrap(),
                place_cb,
                layer_cb,
                vbuf: vbuf.unwrap(),
                vcap,
                textures: Vec::new(),
                samples,
                targets: None,
            };
            gpu.textures = r.layers.iter().map(|l| gpu.upload(l).ok()).collect();
            Ok(gpu)
        }
    }
    fn upload(&self, l: &Layer) -> Result<ID3D11ShaderResourceView, String> {
        let mips = &l.tex.mips;
        let desc = D3D11_TEXTURE2D_DESC {
            Width: mips[0].w as u32,
            Height: mips[0].h as u32,
            MipLevels: mips.len() as u32,
            ArraySize: 1,
            Format: DXGI_FORMAT_B8G8R8A8_UNORM,
            SampleDesc: DXGI_SAMPLE_DESC { Count: 1, Quality: 0 },
            Usage: D3D11_USAGE_IMMUTABLE,
            BindFlags: D3D11_BIND_SHADER_RESOURCE.0 as u32,
            ..Default::default()
        };
        let init: Vec<D3D11_SUBRESOURCE_DATA> =
            mips.iter().map(|m| D3D11_SUBRESOURCE_DATA { pSysMem: m.px.as_ptr() as *const _, SysMemPitch: (m.w * 4) as u32, SysMemSlicePitch: 0 }).collect();
        unsafe {
            let mut tex = None;
            self.device.CreateTexture2D(&desc, Some(init.as_ptr()), Some(&mut tex)).map_err(err)?;
            let mut srv = None;
            self.device.CreateShaderResourceView(&tex.unwrap(), None, Some(&mut srv)).map_err(err)?;
            Ok(srv.unwrap())
        }
    }
    fn targets(&mut self, w: u32, h: u32) -> Result<(), String> {
        if self.targets.as_ref().is_some_and(|t| t.w == w && t.h == h) {
            return Ok(());
        }
        self.targets = None;
        unsafe {
            let mut desc = D3D11_TEXTURE2D_DESC {
                Width: w,
                Height: h,
                MipLevels: 1,
                ArraySize: 1,
                Format: DXGI_FORMAT_B8G8R8A8_UNORM,
                SampleDesc: DXGI_SAMPLE_DESC { Count: 1, Quality: 0 },
                Usage: D3D11_USAGE_DEFAULT,
                BindFlags: D3D11_BIND_RENDER_TARGET.0 as u32,
                ..Default::default()
            };
            let make = |d: &D3D11_TEXTURE2D_DESC| -> Result<ID3D11Texture2D, String> {
                let mut t = None;
                self.device.CreateTexture2D(d, None, Some(&mut t)).map_err(err)?;
                Ok(t.unwrap())
            };
            let resolved = make(&desc)?;
            let msaa = if self.samples > 1 {
                let mut m = desc;
                m.SampleDesc = DXGI_SAMPLE_DESC { Count: self.samples, Quality: 0 };
                Some(make(&m)?)
            } else {
                None
            };
            desc.Usage = D3D11_USAGE_STAGING;
            desc.BindFlags = 0;
            desc.CPUAccessFlags = D3D11_CPU_ACCESS_READ.0 as u32;
            let staging = make(&desc)?;
            let mut rtv = None;
            let target: &ID3D11Texture2D = msaa.as_ref().unwrap_or(&resolved);
            self.device.CreateRenderTargetView(target, None, Some(&mut rtv)).map_err(err)?;
            self.targets = Some(Targets { w, h, msaa, resolved, staging, rtv: rtv.unwrap() });
        }
        Ok(())
    }

    /// Draws the prepared queue into `frame` (cleared first).
    pub fn draw(&mut self, r: &Renderer, frame: &mut Frame, s: &Pose, t: Target) -> Result<(), String> {
        let (w, h) = (frame.w as u32, frame.h as u32);
        self.targets(w, h)?;
        let total: usize = r.queue.iter().map(|d| r.layers[d.layer].data.len()).sum();
        if total > self.vcap {
            return Err("vertex buffer too small".into());
        }
        unsafe {
            let ctx = &self.ctx;
            let tg = self.targets.as_ref().unwrap();
            // Vertices of every queued layer, back to back.
            let mut m = D3D11_MAPPED_SUBRESOURCE::default();
            ctx.Map(&self.vbuf, 0, D3D11_MAP_WRITE_DISCARD, 0, Some(&mut m)).map_err(err)?;
            let dst = std::slice::from_raw_parts_mut(m.pData as *mut [f32; 4], self.vcap);
            let mut ranges = Vec::with_capacity(r.queue.len());
            let mut at = 0;
            for d in &r.queue {
                let data = &r.layers[d.layer].data;
                dst[at..at + data.len()].copy_from_slice(data);
                ranges.push((at, data.len()));
                at += data.len();
            }
            ctx.Unmap(&self.vbuf, 0);
            let place = PlaceCb { place: [t.ox as f32, t.oy as f32, t.size as f32, 0.0], target: [w as f32, h as f32, 0.0, 0.0] };
            ctx.UpdateSubresource(&self.place_cb, 0, None, &place as *const _ as *const _, 0, 0);
            ctx.ClearRenderTargetView(&tg.rtv, &[0.0; 4]);
            ctx.OMSetRenderTargets(Some(&[Some(tg.rtv.clone())]), None);
            ctx.OMSetBlendState(&self.blend, None, u32::MAX);
            ctx.RSSetState(&self.raster);
            ctx.RSSetViewports(Some(&[D3D11_VIEWPORT { TopLeftX: 0.0, TopLeftY: 0.0, Width: w as f32, Height: h as f32, MinDepth: 0.0, MaxDepth: 1.0 }]));
            let c = t.clip;
            ctx.RSSetScissorRects(Some(&[RECT { left: c[0].max(0), top: c[1].max(0), right: c[2].min(w as i32), bottom: c[3].min(h as i32) }]));
            ctx.IASetInputLayout(&self.layout);
            ctx.IASetPrimitiveTopology(D3D11_PRIMITIVE_TOPOLOGY_TRIANGLELIST);
            let stride = 16u32;
            let offset = 0u32;
            ctx.IASetVertexBuffers(0, 1, Some(&Some(self.vbuf.clone())), Some(&stride), Some(&offset));
            ctx.VSSetShader(&self.vs, None);
            ctx.VSSetConstantBuffers(0, Some(&[Some(self.place_cb.clone())]));
            ctx.PSSetShader(&self.ps, None);
            ctx.PSSetConstantBuffers(1, Some(&[Some(self.layer_cb.clone())]));
            ctx.PSSetSamplers(0, Some(&[Some(self.sampler.clone())]));
            for (d, (start, count)) in r.queue.iter().zip(ranges) {
                let Some(srv) = &self.textures[d.layer] else { continue };
                let cb = layer_uniforms(r, &r.layers[d.layer], d, s, t.size);
                ctx.UpdateSubresource(&self.layer_cb, 0, None, &cb as *const _ as *const _, 0, 0);
                ctx.PSSetShaderResources(0, Some(&[Some(srv.clone())]));
                ctx.Draw(count as u32, start as u32);
            }
            if let Some(ms) = &tg.msaa {
                ctx.ResolveSubresource(&tg.resolved, 0, ms, 0, DXGI_FORMAT_B8G8R8A8_UNORM);
            }
            ctx.CopyResource(&tg.staging, &tg.resolved);
            let mut m = D3D11_MAPPED_SUBRESOURCE::default();
            ctx.Map(&tg.staging, 0, D3D11_MAP_READ, 0, Some(&mut m)).map_err(err)?;
            let pitch = m.RowPitch as usize;
            for y in 0..h as usize {
                let src = std::slice::from_raw_parts((m.pData as *const u8).add(y * pitch) as *const u32, w as usize);
                frame.px[y * frame.w..(y + 1) * frame.w].copy_from_slice(src);
            }
            ctx.Unmap(&tg.staging, 0);
        }
        Ok(())
    }
}

/// The per-layer uniforms of renderer.mjs `draw()`.
fn layer_uniforms(r: &Renderer, layer: &Layer, d: &Draw, s: &Pose, canvas_px: f64) -> LayerCb {
    let (w, h) = (r.size[0], r.size[1]);
    let aa = 1.5 / (canvas_px / (1.0 + 2.0 * r.padding) * 0.88);
    let [x0, y0, x1, y1] = layer.bx;
    let mut cb = LayerCb::default();
    cb.v[0] = [d.opacity as f32, d.eye_open as f32, aa as f32, 0.0];
    cb.v[1] = [(x0 / w) as f32, (y0 / h) as f32, ((x1 - x0) / w) as f32, ((y1 - y0) / h) as f32];
    if let (Some(left), true) = (layer.eye_left, d.eye_open >= 0.0) {
        if let Some(e) = r.eyes.iter().find(|e| (e.side == "l") == left) {
            let f = eye_frame(d.eye_open.max(0.0), s.side_eye);
            let half = (e.bx[3] - e.bx[1]) / h * 0.47;
            cb.v[0][3] = f.iris as f32;
            cb.v[2] = [(e.center[0] / w) as f32, (e.center[1] / h) as f32, e.tilt as f32, half as f32];
            cb.v[3] = [(f.radius / w) as f32, (f.curve / h) as f32, (eye_style::STROKE / h / 2.0) as f32, f.line as f32];
            cb.v[4] = [(f.upper * half) as f32, (f.lower * half) as f32, f.corner as f32, f.side_eye as f32];
            cb.v[5] = [
                (s.gx * f.gaze_span) as f32,
                (s.gy * 0.006) as f32,
                (eye_style::GLANCE_RADIUS / w) as f32,
                (half * eye_style::GLANCE_DEPTH * (d.eye_open / 0.5).clamp(0.0, 1.0)) as f32,
            ];
        }
    }
    cb
}
