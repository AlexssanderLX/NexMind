using System;
using System.IO;
using System.Net.Sockets;
using System.Threading.Tasks;

sealed class NexChromeHost {
    static void Main() {
        using (var tcp = new TcpClient()) {
            try { tcp.Connect("127.0.0.1", 9334); }
            catch { return; }
            var net = tcp.GetStream();
            var stdin = Console.OpenStandardInput();
            var stdout = Console.OpenStandardOutput();
            var toNet = Task.Run(() => Pump(stdin, net));
            var toChrome = Task.Run(() => Pump(net, stdout));
            Task.WaitAny(toNet, toChrome);
        }
    }

    static void Pump(Stream input, Stream output) {
        var lenBuf = new byte[4];
        while (ReadExact(input, lenBuf)) {
            int len = BitConverter.ToInt32(lenBuf, 0);
            if (len <= 0 || len > 1024 * 1024) return;
            var body = new byte[len];
            if (!ReadExact(input, body)) return;
            output.Write(lenBuf, 0, 4);
            output.Write(body, 0, body.Length);
            output.Flush();
        }
    }

    static bool ReadExact(Stream stream, byte[] buf) {
        int offset = 0;
        while (offset < buf.Length) {
            int read = stream.Read(buf, offset, buf.Length - offset);
            if (read <= 0) return false;
            offset += read;
        }
        return true;
    }
}
