const assert = require("node:assert");
const test = require("node:test");

test("portal test harness is available", () => {
  assert.equal("atlas-portal".includes("portal"), true);
});
