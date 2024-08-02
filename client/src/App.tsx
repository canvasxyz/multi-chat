import React, { useState, useEffect } from "react"
import { Chat } from "./Chat.js"
import { PrivateKeyAccount, privateKeyToAccount, generatePrivateKey } from "viem/accounts"
import { Hex } from "viem"

const styleUnset = { all: "unset" } as const

export const App = () => {
	const [account, setAccount] = useState<PrivateKeyAccount | null>(null)
	useEffect(() => {
		const privkey = localStorage.getItem("burnerWallet")
		if (privkey !== null && privkey.startsWith("0x")) {
			try {
				setAccount(privateKeyToAccount(privkey as Hex))
				return
			} catch (err) {}
		}
		const newPrivkey = generatePrivateKey()
		localStorage.setItem("burnerWallet", newPrivkey)
		setAccount(privateKeyToAccount(newPrivkey))
	}, [])
	useState

	return <>{account && <Chat account={account} />}</>
}
