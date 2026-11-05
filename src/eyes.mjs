const smooth=x=>{x=Math.max(0,Math.min(1,x));return x*x*(3-2*x);};
export const EYE_STYLE={radius:64,curve:7.5,stroke:10};
// The upper lid reaches the neutral arc first; the lower lid then closes the slit.
// One mask and stroke handle the entire cycle, including the fully closed frame.
export function eyeFrame(openness,sideEye=0){
 const o=Math.max(0,Math.min(1,openness)),m=Math.max(0,Math.min(1,sideEye));return {upper:1.12*smooth((o-.5)/.5),lower:1.12*smooth(o/.5)*(1-.45*m),radius:EYE_STYLE.radius+12*smooth(o),line:1-smooth((o-.6)/.35),iris:smooth(o/.06),corner:1-smooth((o-.5)/.4),curve:EYE_STYLE.curve*(1-.9*m),irisWidth:1-.4*m,gazeSpan:.009+.014*m};
}
