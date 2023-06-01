/**
Copy from https://github.com/tiddly-gittly/itonnote-plugin/blob/e8afe16e857396f338cea23b82ad46300d2fb87d/src/Startup/closeSidebarOnMobile.ts

Closes the sidebar on start, so wiki looks like an official website
 */

/* eslint-disable @typescript-eslint/no-unsafe-member-access */
exports.name = 'close-sidebar-on-start';
exports.platforms = ['browser'];
// modules listed in https://tiddlywiki.com/dev/#StartupMechanism
// not blocking rendering
exports.after = ['rootwidget'];
/* eslint-enable @typescript-eslint/no-unsafe-member-access */

const closeSidebar = () => {
  $tw.wiki.addTiddler({ title: '$:/state/sidebar', text: 'no' });
  $tw.wiki.addTiddler({ title: '$:/state/notebook-sidebar', text: 'no' });
};

const closeSidebarOnStart = (event) => {
	closeSidebar();
  return event;
};

const setup = () => {
  $tw.hooks.addHook('th-opening-default-tiddlers-list', closeSidebarOnStart);
  closeSidebarOnStart();
};

exports.startup = setup;