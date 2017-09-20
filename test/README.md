MAIF connector tests howto
==========================

This document shows how to run the maif connector tests. These are more non regression tests than
unit tests.

How to make it work ?

Your first have to connect a MAIF account on the Collect application.
Then you have to run

```sh
yarn dev
```

This will create the token associated to your cozy, specified in the COZY_URL defined in the
`data/env.js` file

If you change COZY_URL, don't forget to remove the `data/token.json` and run `yarn dev` one more
time so that a new `data/token.json` is generated.

Then, you can run the `yarn test` command which will run the tests.
