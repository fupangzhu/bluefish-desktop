using System;
using System.Diagnostics;
using System.IO;
using System.Windows.Forms;
internal static class BluefishLauncher {
 [STAThread] static void Main() {
  string root=AppDomain.CurrentDomain.BaseDirectory;
  string runtime=Path.Combine(root,"node_modules","electron","dist","electron.exe");
  if(!File.Exists(runtime)){MessageBox.Show("请先完整解压运行包，再启动蓝色肥鱼。", "蓝色肥鱼");return;}
  try {var p=new ProcessStartInfo(runtime,"\""+root.TrimEnd(Path.DirectorySeparatorChar)+"\"");p.WorkingDirectory=root;p.UseShellExecute=false;p.CreateNoWindow=true;Process.Start(p);}
  catch(Exception e){MessageBox.Show(e.Message,"蓝色肥鱼启动失败");}
 }
}
