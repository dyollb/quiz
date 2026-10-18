// Serves the mkcert root CA over plain HTTP on the LAN so a phone can
// download it without any HTTPS/certificate chicken-and-egg problem.
//
//   npm run ca        -> prints a URL like http://192.168.1.153:8383
//
// Open that URL on the phone -> tap "Download rootCA.pem" -> Android:
// Settings search "CA certificate" -> "Install a CA certificate" -> pick the file.
import { createServer } from 'node:http'
import { spawnSync } from 'node:child_process'
import { readFileSync } from 'node:fs'
import { networkInterfaces } from 'node:os'
import { resolve } from 'node:path'

const PORT = Number(process.env.CA_PORT ?? 8383)

const caroot = spawnSync('mkcert', ['-CAROOT'], { encoding: 'utf8' }).stdout.trim()
if (!caroot) {
  console.error('mkcert not found. Install it first: brew install mkcert && mkcert -install')
  process.exit(1)
}
const caPem = readFileSync(resolve(caroot, 'rootCA.pem'))

const html = `<!doctype html>
<html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>Install QuizTime dev CA</title></head>
<body style="font-family:sans-serif;max-width:32rem;margin:2rem auto;padding:0 1rem">
<h1>QuizTime dev certificate</h1>
<p><a href="/rootCA.pem" download
   style="display:inline-block;padding:.8rem 1.4rem;background:#46178f;color:#fff;border-radius:.5rem;text-decoration:none">
   Download rootCA.pem</a></p>
<h3>Android</h3>
<ol>
<li>Open <b>Settings</b>, search for <b>CA certificate</b></li>
<li>Tap <b>Install a CA certificate</b> (or Encryption &amp; credentials &rarr; Install a certificate &rarr; CA certificate)</li>
<li>Pick the downloaded <b>rootCA.pem</b> and confirm the warning</li>
<li>Open <code>https://lloyd-lptp-2.local:5173</code> (or the IP shown in the terminal running <code>npm run dev</code>) in Chrome</li>
<li>Chrome menu &rarr; <b>Add to Home screen / Install app</b></li>
</ol>
<h3>Windows / iOS</h3>
<p>Windows: download, then double-click &rarr; install into <i>Trusted Root Certification Authorities</i>.<br>
iOS: download, then Settings &rarr; Profile Downloaded &rarr; Install, then Settings &rarr; General &rarr; About &rarr;
Certificate Trust Settings &rarr; enable full trust.</p>
</body></html>`

const server = createServer((req, res) => {
  if (req.url === '/rootCA.pem') {
    res.writeHead(200, {
      'content-type': 'application/x-x509-ca-cert',
      'content-disposition': 'attachment; filename="rootCA.pem"',
      'content-length': caPem.length,
    })
    res.end(caPem)
  } else {
    res.writeHead(200, { 'content-type': 'text/html; charset=utf-8' })
    res.end(html)
  }
})

server.listen(PORT, '0.0.0.0', () => {
  const ips = Object.values(networkInterfaces())
    .flat()
    .filter((i) => i && i.family === 'IPv4' && !i.internal)
    .map((i) => i.address)
  console.log(`Serving mkcert root CA (from ${caroot}) on:`)
  for (const ip of ips) console.log(`  http://${ip}:${PORT}   <- open this on your phone`)
  console.log('Stop with Ctrl+C when done. The phone only needs to keep this file, not this server.')
})
