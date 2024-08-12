import React, { useState, useEffect } from "react"
import { PrivateKeyAccount } from "viem"

import { ChatInstance } from "./ChatInstance.js"

export type Message = {
	id: "string"
	content: "string"
	address: "string"
	timestamp: "number"
}

type PeerId = any // TODO

export const Chat = ({ account }: { account: PrivateKeyAccount }) => {
	const [rooms, setRooms] = useState<string[]>([])
	const [prefix, setPrefix] = useState("room")
	const [automessage, setAutomessage] = useState(false)

	const [onlinePeers, setOnlinePeers] = useState<Record<string, PeerId>>({})

	// useEffect(() => {
	// 	const handlePresenceChange = ({
	// 		detail: { peers },
	// 	}: CanvasEvents["presence:join"] | CanvasEvents["presence:leave"]) => {
	// 		const onlinePeers: Record<string, PeerId> = {} // TODO: re-export PeerId
	// 		for (const { peerId, env, lastSeen, topics } of Object.values(peers)) {
	// 			if (env !== "browser") continue
	// 			for (const topic of topics) {
	// 				if (topic.startsWith("canvas/" + prefix)) {
	// 					if (onlinePeers[topic] === undefined) onlinePeers[topic] = []
	// 					onlinePeers[topic].push(peerId)
	// 				}
	// 			}
	// 		}
	// 		setOnlinePeers(onlinePeers)
	// 	}

	// 	app?.addEventListener("presence:join", handlePresenceChange)
	// 	app?.addEventListener("presence:leave", handlePresenceChange)
	// 	return () => {
	// 		app?.removeEventListener("presence:join", handlePresenceChange)
	// 		app?.removeEventListener("presence:leave", handlePresenceChange)
	// 	}
	// }, [app])

	return (
		<>
			<div style={{ position: "fixed", top: 20, right: 30 }}>
				Prefix:{" "}
				<input
					type="text"
					placeholder="prefix"
					value={prefix}
					onChange={(e) => {
						setPrefix(e.target.value)
					}}
				/>
			</div>
			<div style={{ position: "fixed", top: 50, right: 30 }}>
				<label>
					Auto message:{" "}
					<input
						type="checkbox"
						checked={automessage}
						onChange={(e) => {
							setAutomessage(!automessage)
						}}
						style={{ position: "relative", top: 2 }}
					/>
				</label>
			</div>
			<div style={{ position: "fixed", top: 80, right: 30 }}>
				<input
					type="button"
					value="Clear data"
					onClick={async (e) => {
						// clear all indexeddb and localstorage
						window.localStorage.clear()
						const dbs = await window.indexedDB.databases()
						dbs.forEach((db) => {
							if (db.name === undefined) return
							window.indexedDB.deleteDatabase(db.name)
						})
						location.reload()
					}}
				/>
			</div>
			{new Array(...Array(20)).map((unused, index) => {
				const numOnline = onlinePeers[`canvas/${prefix}-${index}.canvas.xyz`]?.length
				return (
					<div key={index}>
						<button
							key={index}
							style={{
								margin: "10px 12px 0",
							}}
							onClick={() => {
								const room = `${prefix}-${index}.canvas.xyz`
								if (rooms.indexOf(room) !== -1) return
								setRooms([...rooms, room])
							}}
						>
							Join room {index} {numOnline && `(${numOnline} here)`}
						</button>
					</div>
				)
			})}
			{rooms.map((room, index) => (
				<ChatInstance key={room} topic={room} left={30 + index * 300} account={account} automessage={automessage} />
			))}
		</>
	)
}
