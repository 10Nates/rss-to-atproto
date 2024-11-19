FROM denoland/deno:2.0.6

WORKDIR /app

USER deno

COPY . .

RUN deno cache main.ts

CMD ["task", "start"]