ARG BUILD_FROM
FROM ${BUILD_FROM}

WORKDIR /app

RUN apk add --no-cache nodejs npm

COPY package.json package-lock.json ./
RUN npm install

COPY server ./server
COPY web ./web
COPY vite.config.js ./

RUN npm run build
RUN npm prune --omit=dev

RUN mkdir -p /data/meal-atlas

COPY addon/run.sh /run.sh
RUN chmod a+x /run.sh

CMD [ "/run.sh" ]
