FROM denoland/deno:2.0.6

WORKDIR /app

COPY --chown=deno:deno . .

USER deno

RUN deno cache main.ts

CMD ["task", "start"]