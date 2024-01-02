import React, { useRef, useState, useEffect } from "react"

import { type CanvasEvents, AppConnectionStatus, Connections } from "@canvas-js/core"
import { useCanvas, useLiveQuery } from "@canvas-js/hooks"
import { SIWESigner } from "@canvas-js/chain-ethereum"
import { getBurnerPrivateKey } from "@latticexyz/common"
import { ethers } from "ethers"
import { groupBy } from "lodash"
import { ChatInstance } from "./ChatInstance"

export type Message = {
  id: "string"
  content: "string"
  address: "string"
  timestamp: "number"
}

export const Chat = () => {
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
        <ChatInstance key={room} topic={room} left={30 + index * 300} />
      ))}
    </>
  )
}
