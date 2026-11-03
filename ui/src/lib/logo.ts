// The mark of the app, from assets/icons of this repository (rule APP-11): the hub build gets a file of its own
// (img-src 'self'), the web build a data: URL (img-src data:, the page requests nothing).

import desktop from '../../../assets/icons/tasks-desktop/tasks-desktop-small.svg?url';
import web from '../../../assets/icons/tasks-web/tasks-web-small.svg?url';

export const logo: string = import.meta.env.MODE === 'web' ? web : desktop;
