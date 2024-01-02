import { useState } from "react"
import { WalletClient } from "viem"

import { ChatInstance } from "./ChatInstance"

export type Message = {
  id: "string"
  content: "string"
  address: "string"
  timestamp: "number"
}

export const Chat = ({ walletClient }: { walletClient: WalletClient }) => {
  const [rooms, setRooms] = useState<string[]>([])
  const [prefix, setPrefix] = useState("room")

  return (
    <>
      <input
        type="text"
        placeholder="prefix"
        value={prefix}
        onChange={(e) => {
          setPrefix(e.target.value)
        }}
        style={{ position: "fixed", top: 20, right: 130 }}
      />
      {new Array(...Array(20)).map((unused, index) => {
        return (
          <button
            key={index}
            style={{
              position: "fixed",
              top: 20 + index * 35,
              right: 20,
            }}
            onClick={() => {
              const room = `${prefix}-${index + 1}.xyz`
              if (rooms.indexOf(room) !== -1) return
              setRooms([...rooms, room])
            }}
          >
            Join room {index + 1}
          </button>
        )
      })}
      {rooms.map((room, index) => (
        <ChatInstance
          key={room}
          topic={room}
          left={30 + index * 300}
          walletClient={walletClient}
        />
      ))}
    </>
  )
}
