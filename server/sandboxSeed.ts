// Prints the demo data (src/seed.ts) as JSON, made right now. server/sandbox.ts runs this in a short-lived process with
// the person's time zone (TZ), so a demo company made today has this week's meetings at the right hours and tasks due
// on the right days, exactly like the demo in a browser. It reads nothing else and has no secrets in its environment.
import { seed } from '../src/seed.ts';

process.stdout.write(JSON.stringify(seed()));
