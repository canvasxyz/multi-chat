FROM node:20-buster

WORKDIR /app
COPY package.json package.json
RUN npm install --omit-dev
COPY lib lib

CMD ["npm", "run", "start"]
