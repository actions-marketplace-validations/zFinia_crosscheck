// Thin adapter: runs the SHIPPED CrossCheck engine against a git commit.
// No rule logic is reimplemented here.
import { readCommit, resolveRef } from "../../../src/providers.mjs";
import { scanFiles, selectTiers, VERSION } from "../../../src/crosscheck.mjs";
import { LOCKFILES, INSTRUCTION_FILES } from "../../../src/evidence.mjs";
export { readCommit, resolveRef, scanFiles, selectTiers, VERSION, LOCKFILES, INSTRUCTION_FILES };
