// All of Bahasa Indonesia, one file per area so builders working in parallel never edit the same file.
// Loaded only when someone picks Indonesian (src/i18n/index.ts, setLang): English users never download it.
import common from './common';
import shell from './shell';
import ui from './ui';
import settings from './settings';
import auth from './auth';
import home from './home';
import onboarding from './onboarding';
import mail from './mail';
import calendar from './calendar';
import notes from './notes';
import chat from './chat';
import meet from './meet';
import drive from './drive';
import tasks from './tasks';
import projects from './projects';
import teams from './teams';
import tables from './tables';
import vault from './vault';
import guest from './guest';
import admin from './admin';
import server from './server';
import misc from './misc';

const id: Record<string, string> = { ...common, ...shell, ...ui, ...settings, ...auth, ...home, ...onboarding, ...mail, ...calendar, ...notes, ...chat, ...meet, ...drive, ...tasks, ...projects, ...teams, ...tables, ...vault, ...guest, ...admin, ...server, ...misc };

export default id;
