# multi-chat

### Developing

Build the TypeScript project:

```
npm run dev
```

Then, run the client vite server:

```
npm run dev -w client
```

Run the multi-chat server backend:

```
npm run start -w server
```

### Deploying

Build the client project:

```
npm install
npm run build
serve dist
```

Deploy the server to Fly:

```
cd server
fly deploy
```

Deploy the client to Vercel:

```
vercel
```