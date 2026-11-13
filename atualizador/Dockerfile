FROM docker:27-cli
RUN apk add --no-cache git nodejs tzdata
WORKDIR /app
COPY servidor.js ./
EXPOSE 4000
# A imagem docker:cli trata o comando como subcomando do docker; por isso o ENTRYPOINT próprio.
ENTRYPOINT ["node", "servidor.js"]
