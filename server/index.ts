import http from "node:http"
import * as cbor from "@ipld/dag-cbor"

import { app } from "./api.js"
import { getLibp2p } from "./libp2p.js"

const { PORT = "3030", FLY_APP_NAME } = process.env
const hostname = FLY_APP_NAME !== undefined ? `${FLY_APP_NAME}.internal` : "localhost"

http.createServer(app).listen(parseInt(PORT), () => {
	console.log(`HTTP API listening on http://${hostname}:${PORT}`)
})
