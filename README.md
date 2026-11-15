# Headline Wars

A daily political news prediction game. Choose a fighter, pick a side, and call the headlines.

## Status

Early frontend prototype. Fighter selection and the transition to the homepage are interactive. Fighter artwork is placeholder text; voting, scores, and questions are not live. All displayed results are fictional.

## Development

Requires Node.js 20 or later.

```sh
npm install
npm run dev
```

Run `npm run build` to type-check and produce the static site in `dist/`.

## Structure

- `src/fighters.ts`: team and fighter definitions.
- `src/main.ts`: selection, transition, and homepage interactions.
- `src/styles.css`: responsive styles and reduced-motion support.

The prototype has no backend, production database, or API keys. Voting, scoring, and automated headline verification will be implemented and tested separately before launch.

## Game rules

Each resolved headline awards one point to the team with the higher proportion of correct predictions. Ties award no point. Teams are self-selected; voting results are not representative political polls. No real-money wagering is involved.

## License

Not yet selected. A public repository is not automatically open source without a license.
