import React, { useRef, useState, useEffect, useCallback } from "react"
import { Virtuoso, VirtuosoHandle } from "react-virtuoso"
import type { Connection } from "@libp2p/interface/connection"

import { defaultBootstrapList } from "@canvas-js/core"
import { useCanvas, useLiveQuery } from "@canvas-js/hooks"
import { SIWESigner } from "@canvas-js/chain-ethereum"
import { getBurnerPrivateKey } from "@latticexyz/common"
import { ethers } from "ethers"

type Message = {
  id: "string"
  message: "string"
  address: "string"
  timestamp: "number"
}

export const Chat = () => {
  return (
    <>
      <ChatInstance topic="xyz.canvas.room1" left={30} />
      <ChatInstance topic="xyz.canvas.room2" left={330} />
    </>
  )
}

export const ChatInstance = ({ topic, left }) => {
  const [signer] = useState(() => new ethers.Wallet(getBurnerPrivateKey()))
  const [chatOpen, setChatOpen] = useState(true)
  const scrollboxRef = useRef<VirtuosoHandle>(null)
  const inputRef = useRef<HTMLInputElement>(null)

  const [connections, setConnections] = useState<Connection[]>([])
  const connectionsRef = useRef<Connection[]>(connections)

  const { app } = useCanvas({
    contract: {
      models: {
        messages: {
          id: "primary",
          message: "string",
          address: "string",
          timestamp: "integer",
        },
      },
      actions: {
        sendMessage: (db, { message }, { id, address, timestamp }) => {
          db.set("messages", { id, message, address, timestamp })
        },
      },
      topic,
    },
    signers: [new SIWESigner({ signer })],
  })
  const messages = useLiveQuery<Message>(app, "messages")

  // set up app onload
  const handleConnectionOpen = useCallback(
    ({ detail: connection }: CustomEvent<Connection>) => {
      const connections = [...connectionsRef.current, connection]
      setConnections(connections)
      connectionsRef.current = connections
    },
    [],
  )
  const handleConnectionClose = useCallback(
    ({ detail: connection }: CustomEvent<Connection>) => {
      const connections = connectionsRef.current.filter(
        ({ id }) => id !== connection.id,
      )
      setConnections(connections)
      connectionsRef.current = connections
    },
    [],
  )
  useEffect(() => {
    if (!app) return

    app.start()
    app.libp2p?.addEventListener("connection:open", handleConnectionOpen)
    app.libp2p?.addEventListener("connection:close", handleConnectionClose)
    return () => {
      app.libp2p?.removeEventListener("connection:open", handleConnectionOpen)
      app.libp2p?.removeEventListener("connection:close", handleConnectionClose)
    }
  }, [app])

  const toggleChatOpen = () => {
    setChatOpen((open) => !open)
    window.requestAnimationFrame(() => {
      setTimeout(() => {
        if (scrollboxRef.current) scrollboxRef.current.scrollToIndex(9999)
      }, 10)
    })
  }

  // bind global hotkey
  useEffect(() => {
    const keyup = (e: KeyboardEvent) => {
      if (
        (e.code === "Enter" &&
          (e.target as HTMLInputElement).nodeName !== "INPUT") ||
        e.code === "Escape"
      ) {
        toggleChatOpen()
      }
    }
    document.addEventListener("keyup", keyup)
    return () => document.removeEventListener("keyup", keyup)
  }, [app])

  return (
    <div
      style={{
        border: "1px solid",
        borderBottom: "none",
        position: "fixed",
        bottom: 0,
        left,
        width: 280,
      }}
    >
      <div
        style={{
          width: "100%",
          padding: 10,
        }}
        onClick={() => toggleChatOpen()}
        title={
          app?.peerId +
          "\n---\n" +
          connections.map((c) => c.remoteAddr.toString()).join("\n")
        }
      >
        Chat (
        {
          connections.filter(
            (c) => defaultBootstrapList.indexOf(c.remoteAddr.toString()) === -1,
          ).length
        }{" "}
        peers)
      </div>
      {chatOpen && (
        <div style={{ borderTop: "1px solid" }}>
          <Virtuoso
            ref={scrollboxRef}
            style={{ padding: 10, height: 250, overflowY: "scroll" }}
            data={messages || []}
            followOutput="auto"
            itemContent={(index, message) => (
              <div key={message.id as string}>
                {message.address.slice(9, 15)}: {message.message}
              </div>
            )}
          />
          <form
            style={{ padding: 10 }}
            onSubmit={async (event) => {
              event.preventDefault()

              const message = inputRef.current?.value
              if (!app || !message || !message.trim()) return

              app.actions.sendMessage({ message }).then(() => {
                if (inputRef.current) {
                  inputRef.current.value = ""
                }
              })
            }}
          >
            <input
              autoFocus
              ref={inputRef}
              type="text"
              placeholder="Send a message"
              onKeyPress={(e) => {
                e.stopPropagation()
              }}
            />{" "}
            <input type="submit" value="Send" />
          </form>
        </div>
      )}
    </div>
  )
}
