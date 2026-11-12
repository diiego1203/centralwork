self.addEventListener('install',()=>self.skipWaiting());
self.addEventListener('activate',event=>event.waitUntil(self.clients.claim()));
self.addEventListener('notificationclick',event=>{event.notification.close();event.waitUntil(self.clients.matchAll({type:'window'}).then(list=>list[0]?list[0].focus():self.clients.openWindow(self.registration.scope)));});
