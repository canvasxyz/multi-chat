import http from "node:http"
import stream from "node:stream"

import { StatusCodes, getReasonPhrase } from "http-status-codes"

export class ProxyServer {
	public readonly server = http.createServer((_, res) => void res.writeHead(StatusCodes.BAD_REQUEST).end())

	public constructor(proxyPort: number, connectionGater: (originPort: number) => boolean) {
		this.server.on("upgrade", (req, reqSocket) => {
			const { host: _, "fly-forwarded-port": originPort, ...headers } = req.headers

			if (typeof originPort !== "string") {
				return rejectRequest(reqSocket, StatusCodes.BAD_REQUEST)
			}

			if (!connectionGater(parseInt(originPort))) {
				return rejectRequest(reqSocket, StatusCodes.NOT_FOUND)
			}

			const proxyReq = http.request({
				host: "localhost",
				port: parseInt(originPort),
				headers,
			})

			proxyReq.end()
			proxyReq.on("upgrade", (proxyRes, resSocket, head) => {
				console.log(`[proxy-server] proxyReq upgrade message on port ${originPort}, statusCode=${proxyRes.statusCode}`)
				if (proxyRes.statusCode === undefined) {
					resSocket.end()
					rejectRequest(reqSocket, StatusCodes.BAD_GATEWAY)
					return
				}

				reqSocket.write("HTTP/1.1 101 Web Socket Protocol Handshake\r\n")
				proxyRes.rawHeaders.forEach((rawHeader, i) =>
					reqSocket.write(i % 2 === 0 ? `${rawHeader}: ` : `${rawHeader}\r\n`),
				)
				reqSocket.write("\r\n")
				reqSocket.pipe(resSocket).pipe(reqSocket)
			})

			proxyReq.on("error", (err) => {
				console.error(`[proxy-server] error thrown by proxyReq`, err)
				reqSocket.end()
			})
		})

		this.server.listen(proxyPort, () =>
			console.log(`[proxy-server] Proxy server listening on http://localhost:${proxyPort}`),
		)
	}

	public close() {
		this.server.close()
		this.server.closeAllConnections()
	}
}

function rejectRequest(reqSocket: stream.Duplex, code: number) {
	const date = new Date()
	reqSocket.write(`HTTP/1.1 ${code} ${getReasonPhrase(code)}\r\n`)
	reqSocket.write(`Date: ${date.toUTCString()}\r\n`)
	reqSocket.write(`\r\n`)
	reqSocket.end()
}
