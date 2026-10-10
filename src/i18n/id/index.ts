// All of Bahasa Indonesia, one file per area so builders working in parallel never edit the same file. An area can
// split its words into parts (settings.ts, settings.ai.ts…).
// Loaded only when someone picks Indonesian (src/i18n/index.ts, setLang): English users never download it.
import common from './common';
import shell from './shell';
import ui from './ui';
import settings from './settings';
import settingsAi from './settings.ai';
import settingsCompany from './settings.company';
import settingsMail from './settings.mail';
import settingsImports from './settings.imports';
import auth from './auth';
import home from './home';
import onboarding from './onboarding';
import mail from './mail';
import mailSorting from './mail.sorting';
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

const id: Record<string, string> = { ...common, ...shell, ...ui, ...settings, ...settingsAi, ...settingsCompany, ...settingsMail, ...settingsImports, ...auth, ...home, ...onboarding, ...mail, ...mailSorting, ...calendar, ...notes, ...chat, ...meet, ...drive, ...tasks, ...projects, ...teams, ...tables, ...vault, ...guest, ...admin, ...server, ...misc };

export default id;
