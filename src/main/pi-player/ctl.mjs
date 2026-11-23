// Cratedigger Pi control bridge — pipes JSON lines between an SSH session's
// stdin/stdout and the receiver's local control socket, so a Mac can ATTACH
// to a receiver it didn't spawn (kiosk-agent-started radio) and drive it with
// the exact same protocol it speaks to a receiver it owns. Exits 1 when no
// receiver is listening — the app reads that as "nothing to attach to."
import { createConnection } from 'node:net'
import { createInterface } from 'node:readline'

const sock = createConnection(`${process.env.HOME}/.cache/cratedigger-pi-player/control.sock`)
sock.on('error', () => process.exit(1))
sock.on('close', () => process.exit(0))
sock.on('connect', () => {
  createInterface({ input: process.stdin }).on('line', (line) => sock.write(line + '\n'))
  createInterface({ input: sock }).on('line', (line) => process.stdout.write(line + '\n'))
  // Grace period on stdin EOF: a response for the final request (quit, or a
  // one-shot pipe) may still be crossing the socket.
  process.stdin.on('end', () => setTimeout(() => process.exit(0), 1500))
})
