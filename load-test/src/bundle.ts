import Debugger from "weald"
// eslint-disable-next-line @typescript-eslint/no-unsafe-member-access, @typescript-eslint/no-explicit-any
;(Debugger as any).useColors = () => false
// ;(Debugger.debug as any).useColors = () => false
// ;(Debugger.default as any).useColors = () => false

import { Canvas } from "@canvas-js/core"
import { multiaddr } from "@multiformats/multiaddr"
;(window as any)._Canvas = Canvas
;(window as any)._multiaddr = multiaddr
