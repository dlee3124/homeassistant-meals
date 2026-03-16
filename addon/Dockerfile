ARG BUILD_FROM
FROM ${BUILD_FROM}

WORKDIR /app

RUN apk add --no-cache nodejs npm

COPY app/package.json ./package.json
RUN npm install --omit=dev

COPY app/server ./server
COPY app/web ./web

RUN mkdir -p /data/meal-atlas

COPY run.sh /run.sh
RUN chmod a+x /run.sh

CMD [ "/run.sh" ]
