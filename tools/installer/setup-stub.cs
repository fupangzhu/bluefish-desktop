using System;
using System.Diagnostics;
using System.Drawing;
using System.IO;
using System.IO.Compression;
using System.Reflection;
using System.Text;
using System.Text.RegularExpressions;
using System.Windows.Forms;

internal static class BluefishSetup {
  const string AppName = "蓝色肥鱼";
  static readonly byte[] Magic = Encoding.ASCII.GetBytes("BLUEFISH-PAYLOAD"); // 16 bytes, at the end of the exe

  [STAThread]
  static void Main() {
    try {
      Log("start");
      string self = Assembly.GetExecutingAssembly().Location;
      Log("self=" + self);
      string payload = Path.Combine(Path.GetTempPath(), "bluefish-setup-" + Guid.NewGuid().ToString("N") + ".zip");
      ExtractPayload(self, payload);
      Log("payload extracted to " + payload + " size=" + new FileInfo(payload).Length);
      string version = ReadVersion(payload);
      Log("version=" + version);

      string installDir = Environment.GetEnvironmentVariable("BLUEFISH_INSTALL_DIR");
      bool testMode = Environment.GetEnvironmentVariable("BLUEFISH_INSTALL_TEST") == "1";
      Log("env installDir=" + (installDir ?? "<null>") + " testMode=" + testMode);
      if (String.IsNullOrEmpty(installDir))
        installDir = Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.LocalApplicationData), "BluefishDesktop");

      string appDir = Path.Combine(installDir, "app");
      string stamp = Path.Combine(installDir, "version.txt");
      string launcher = Path.Combine(appDir, "bluefish-desktop", "蓝色肥鱼.exe");
      Log("installDir=" + installDir + " appDir=" + appDir);
      bool current = File.Exists(launcher) && File.Exists(stamp) && File.ReadAllText(stamp).Trim() == version;
      Log("current=" + current);

      if (!current) {
        RunWithMessage("正在安装 " + AppName + " v" + version + " …", delegate {
          if (Directory.Exists(appDir)) Directory.Delete(appDir, true);
          Directory.CreateDirectory(appDir);
          ZipFile.ExtractToDirectory(payload, appDir);
          File.WriteAllText(stamp, version, Encoding.UTF8);
        });
        Log("extracted");
      }
      try { File.Delete(payload); } catch {}

      if (!testMode) {
        CreateShortcut(launcher, Path.GetDirectoryName(launcher));
        Log("shortcut done; launching");
        Process.Start(new ProcessStartInfo(launcher) {
          WorkingDirectory = Path.GetDirectoryName(launcher),
          UseShellExecute = false
        });
        Log("launched");
      } else {
        Log("test mode: skip shortcut and launch");
      }
      Log("done");
    } catch (Exception e) {
      Log("ERROR " + e);
      MessageBox.Show("安装失败：" + e.Message, AppName, MessageBoxButtons.OK, MessageBoxIcon.Error);
    }
  }

  static void Log(string message) {
    try {
      string path = Environment.GetEnvironmentVariable("BLUEFISH_SETUP_LOG");
      if (String.IsNullOrEmpty(path)) return;
      File.AppendAllText(path, DateTime.Now.ToString("HH:mm:ss.fff") + " " + message + Environment.NewLine, Encoding.UTF8);
    } catch { }
  }

  static void ExtractPayload(string selfPath, string outPath) {
    using (var fs = new FileStream(selfPath, FileMode.Open, FileAccess.Read, FileShare.Read)) {
      const int tailLength = 8 + 16;
      if (fs.Length < tailLength) throw new InvalidDataException("安装包不完整");
      fs.Seek(-tailLength, SeekOrigin.End);
      byte[] tail = new byte[tailLength];
      int read = 0;
      while (read < tailLength) {
        int n = fs.Read(tail, read, tailLength - read);
        if (n <= 0) throw new EndOfStreamException("安装包不完整");
        read += n;
      }
      long length = BitConverter.ToInt64(tail, 0);
      for (int i = 0; i < 16; i++)
        if (tail[8 + i] != Magic[i]) throw new InvalidDataException("安装包数据校验失败");
      long offset = fs.Length - tailLength - length;
      if (offset < 0) throw new InvalidDataException("安装包不完整");
      Log("payload offset=" + offset + " length=" + length);
      fs.Seek(offset, SeekOrigin.Begin);
      using (var outFs = new FileStream(outPath, FileMode.Create, FileAccess.Write)) {
        byte[] buf = new byte[1 << 20];
        long left = length;
        while (left > 0) {
          int n = fs.Read(buf, 0, (int)Math.Min(buf.Length, left));
          if (n <= 0) throw new EndOfStreamException("安装包数据被截断");
          outFs.Write(buf, 0, n);
          left -= n;
        }
      }
    }
  }

  static string ReadVersion(string zipPath) {
    using (var archive = ZipFile.OpenRead(zipPath)) {
      ZipArchiveEntry entry = archive.GetEntry("bluefish-desktop/package.json");
      if (entry == null) return "0";
      using (var reader = new StreamReader(entry.Open(), Encoding.UTF8)) {
        Match match = Regex.Match(reader.ReadToEnd(), "\"version\"\\s*:\\s*\"([^\"]+)\"");
        return match.Success ? match.Groups[1].Value : "0";
      }
    }
  }

  static void RunWithMessage(string message, Action work) {
    using (var form = new Form()) {
      form.Text = AppName;
      form.FormBorderStyle = FormBorderStyle.FixedDialog;
      form.StartPosition = FormStartPosition.CenterScreen;
      form.MinimizeBox = false;
      form.MaximizeBox = false;
      form.ControlBox = false;
      form.TopMost = true;
      form.ClientSize = new Size(380, 96);
      form.BackColor = Color.FromArgb(246, 248, 253);
      var label = new Label();
      label.Text = message;
      label.Dock = DockStyle.Fill;
      label.TextAlign = ContentAlignment.MiddleCenter;
      label.Font = new Font("Microsoft YaHei UI", 10f);
      label.ForeColor = Color.FromArgb(42, 67, 123);
      form.Controls.Add(label);
      form.Show();
      form.Refresh();
      Application.DoEvents();
      try { work(); } finally { form.Close(); }
    }
  }

  static void CreateShortcut(string launcher, string workingDir) {
    try {
      Type shellType = Type.GetTypeFromProgID("WScript.Shell");
      if (shellType == null) return;
      object shell = Activator.CreateInstance(shellType);
      string link = Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.DesktopDirectory), AppName + ".lnk");
      object shortcut = shellType.InvokeMember("CreateShortcut", BindingFlags.InvokeMethod, null, shell, new object[] { link });
      Type sc = shortcut.GetType();
      sc.InvokeMember("TargetPath", BindingFlags.SetProperty, null, shortcut, new object[] { launcher });
      sc.InvokeMember("WorkingDirectory", BindingFlags.SetProperty, null, shortcut, new object[] { workingDir });
      sc.InvokeMember("IconLocation", BindingFlags.SetProperty, null, shortcut, new object[] { launcher + ",0" });
      sc.InvokeMember("Description", BindingFlags.SetProperty, null, shortcut, new object[] { "趴在任务栏上的蓝色肥鱼" });
      sc.InvokeMember("Save", BindingFlags.InvokeMethod, null, shortcut, null);
    } catch { }
  }
}
