using System;
using System.Collections.Concurrent;
using System.IO;
using System.Net.Sockets;
using System.Text;
using System.Threading;
using System.Threading.Tasks;

// Host nativo do Nex: o Chrome o chama (native messaging, stdio) e ele repassa os quadros ao Nex em
// 127.0.0.1:9334, provando que e ele com o token de %LOCALAPPDATA%\Nex\chrome-host\token.
// Se o Nex nao esta de pe, espera e tenta de novo. Quando o Chrome solta o stdin, encerra na hora.
// Compilado com o csc do .NET Framework: nada alem de C# 5.
sealed class NexChromeHost {
    const int MaxFrame = 1024 * 1024;
    static readonly BlockingCollection<byte[]> FromChrome = new BlockingCollection<byte[]>(64);
    static volatile bool connected;

    static void Main() {
        Stream stdin = Console.OpenStandardInput();
        Stream stdout = Console.OpenStandardOutput();

        Thread reader = new Thread(delegate() {
            try { ReadChrome(stdin); }
            finally { Environment.Exit(0); }
        });
        reader.IsBackground = true;
        reader.Start();

        while (true) {
            string token = ReadToken();
            if (token != null) {
                try { Session(token, stdout); } catch (Exception) { }
            }
            Thread.Sleep(1000);
        }
    }

    static string TokenPath() {
        string root = Environment.GetEnvironmentVariable("NEX_BROWSER_TOKEN_FILE");
        if (!string.IsNullOrEmpty(root)) return root;
        return Path.Combine(Environment.GetEnvironmentVariable("LOCALAPPDATA") ?? "", "Nex", "chrome-host", "token");
    }

    static string ReadToken() {
        try {
            string t = File.ReadAllText(TokenPath(), Encoding.ASCII).Trim();
            return t.Length > 0 ? t : null;
        } catch (Exception) { return null; }
    }

    static int Port() {
        int p;
        return int.TryParse(Environment.GetEnvironmentVariable("NEX_BROWSER_PORT"), out p) ? p : 9334;
    }

    // Le o Chrome para sempre. Fim do stdin = o Chrome soltou o host.
    static void ReadChrome(Stream stdin) {
        byte[] lenBuf = new byte[4];
        while (ReadExact(stdin, lenBuf)) {
            int len = BitConverter.ToInt32(lenBuf, 0);
            if (len <= 0 || len > MaxFrame) return;
            byte[] body = new byte[len];
            if (!ReadExact(stdin, body)) return;
            if (connected) FromChrome.TryAdd(body);   // sem Nex conectado, o recado nao tem para quem ir
        }
    }

    static void Session(string token, Stream stdout) {
        using (TcpClient tcp = new TcpClient()) {
            tcp.Connect("127.0.0.1", Port());
            NetworkStream net = tcp.GetStream();

            byte[] stale;
            while (FromChrome.TryTake(out stale)) { }
            connected = true;   // antes do hello: o Nex pode responder e o Chrome reagir na mesma hora
            try {
                WriteFrame(net, Encoding.UTF8.GetBytes("{\"hello\":\"" + token + "\"}"));
                Task toChrome = Task.Factory.StartNew(delegate() {
                    byte[] lenBuf = new byte[4];
                    while (ReadExact(net, lenBuf)) {
                        int len = BitConverter.ToInt32(lenBuf, 0);
                        if (len <= 0 || len > MaxFrame) return;
                        byte[] body = new byte[len];
                        if (!ReadExact(net, body)) return;
                        WriteFrame(stdout, body);
                    }
                }, TaskCreationOptions.LongRunning);

                while (!toChrome.IsCompleted) {
                    byte[] msg;
                    if (FromChrome.TryTake(out msg, 200)) WriteFrame(net, msg);
                }
            } finally {
                connected = false;
            }
        }
    }

    static void WriteFrame(Stream output, byte[] body) {
        output.Write(BitConverter.GetBytes(body.Length), 0, 4);
        output.Write(body, 0, body.Length);
        output.Flush();
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
