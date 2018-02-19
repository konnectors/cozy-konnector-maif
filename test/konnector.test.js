Object.assign(process.env, require("../data/env"));

const konnector = require("../konnector");
const { cozyClient } = require("cozy-konnector-libs");

// This tests that the access_token and refresh_token are really renewed by the stack
test("renewToken updates the values of the maif account", () => {
  let MaifAccount = null;
  return fetchMaifAccountContent()
    .then(doc => {
      MaifAccount = doc;
      konnector.account_id = doc._id;
    })
    .then(() => konnector.renewToken({}))
    .then(() => fetchMaifAccountContent())
    .then(doc => {
      expect(doc.oauth.access_token).not.toBe(MaifAccount.oauth.access_token);
      expect(doc.oauth.refresh_token).not.toBe(MaifAccount.oauth.refresh_token);
    });
});

function fetchMaifAccountContent() {
  return cozyClient.data
    .findAll("io.cozy.accounts")
    .then(docs => docs.filter(doc => doc.account_type === "maif"))
    .then(docs => {
      if (docs.length === 1) return docs[0];
      else
        throw new Error(
          `There should be one maif account in DB. ${docs.length} found`
        );
    });
}
