/* eslint-disable max-len */
const {defineExtension, BlockType, ArgumentType} = require('./core');

const R = BlockType.REPORTER;
const C = BlockType.COMMAND;
const B = BlockType.BOOLEAN;

const num = defaultValue => ({type: ArgumentType.NUMBER, defaultValue});
const menu = (name, defaultValue) => ({type: ArgumentType.STRING, menu: name, defaultValue});

const COLORS = {
    color1: '#403041',
    color2: '#302430',
    color3: '#241a24'
};

const ext = (id, name, specs, menus) => defineExtension(id, {name, ...COLORS, menus: menus || {}}, specs);

const account = ext('rotur', 'Rotur Account', [
    {opcode: 'loggedIn', blockType: B, text: 'am I logged in?', local: 'loggedIn'},
    {opcode: 'myUsername', blockType: R, text: 'my username', local: 'username'},
    {opcode: 'myId', blockType: R, text: 'my user id', local: 'id'},
    {label: 'Permissions'},
    {opcode: 'myPermissions', blockType: R, text: 'permissions I have', local: 'permissions'},
    {opcode: 'allows', blockType: B, text: 'does my login allow [SCOPE]?', args: {SCOPE: 'credits:transfer'}, local: 'allows'},
    {opcode: 'request', blockType: C, text: 'ask to allow [SCOPES]', args: {SCOPES: 'credits:transfer, posts:create'}, local: 'request'},
    {label: 'Account'},
    {opcode: 'accountInfo', blockType: R, text: 'my account info', method: 'me.get', scope: 'account:view', map: () => [], result: r => r},
    {opcode: 'accountField', blockType: R, text: 'my account [FIELD]', args: {FIELD: 'sys.currency'}, method: 'me.get', scope: 'account:view', map: () => [], result: (r, a) => (r && typeof r === 'object' ? r[a.FIELD] : '')},
    {opcode: 'checkAuth', blockType: B, text: 'is my login valid?', method: 'me.checkAuth', map: () => [], result: r => Boolean(r && r.username)},
    {opcode: 'myBadges', blockType: R, text: 'my badges', method: 'me.badges', scope: 'account:view', map: () => [], result: r => JSON.stringify((r && r.badge_names) || [])},
    {opcode: 'mySubscription', blockType: R, text: 'my subscription', method: 'me.subscription', scope: 'account:view', map: () => []},
    {opcode: 'blockedUsers', blockType: R, text: 'users I have blocked', method: 'me.blocked', scope: 'blocked:view', map: () => [], result: r => JSON.stringify((r && r.blocked) || [])},
    {opcode: 'block', blockType: C, text: 'block [USER]', args: {USER: 'username'}, method: 'me.block', scope: 'blocked:manage', map: a => [a.USER]},
    {opcode: 'unblock', blockType: C, text: 'unblock [USER]', args: {USER: 'username'}, method: 'me.unblock', scope: 'blocked:manage', map: a => [a.USER]},
    {label: 'People'},
    {opcode: 'profileOf', blockType: R, text: 'profile of [USER]', args: {USER: 'username'}, method: 'profiles.get', map: a => [a.USER]},
    {opcode: 'userExists', blockType: B, text: 'does user [USER] exist?', args: {USER: 'username'}, method: 'profiles.exists', map: a => [a.USER], result: r => Boolean(r && r.exists)},
    {opcode: 'avatarOf', blockType: R, text: 'avatar url of [USER]', args: {USER: 'username'}, method: 'profiles.getAvatarUrl', map: a => [a.USER]},
    {opcode: 'standingOf', blockType: R, text: 'moderation standing of [USER]', args: {USER: 'username'}, method: 'standing.get', map: a => [a.USER]},
    {opcode: 'isBanned', blockType: B, text: 'is [USER] banned?', args: {USER: 'username'}, method: 'check.banned', map: a => [[a.USER]], result: (r, a) => Boolean(r && r[a.USER])},
    {label: 'Notifications'},
    {opcode: 'notifications', blockType: R, text: 'my notifications', method: 'notifications.list', scope: 'notifications:view', map: () => []}
]);

const economy = ext('roturEconomy', 'Rotur Economy', [
    {opcode: 'balance', blockType: R, text: 'my credits', method: 'me.get', scope: 'credits:view', map: () => [], result: r => (r && typeof r['sys.currency'] === 'number' ? r['sys.currency'] : 0)},
    {opcode: 'pay', blockType: C, text: 'send [AMOUNT] credits to [USER] with message [NOTE]', args: {AMOUNT: num(1), USER: 'username', NOTE: ''}, method: 'me.transfer', scope: 'credits:transfer', sensitive: true, confirm: 'send credits', map: a => [a.USER, Number(a.AMOUNT) || 0, a.NOTE]},
    {opcode: 'dailyWait', blockType: R, text: 'seconds until daily claim', method: 'me.claimTime', scope: 'credits:view', map: () => [], result: r => (r && typeof r.wait_time === 'number' ? r.wait_time : 0)},
    {opcode: 'transactions', blockType: R, text: 'my transaction history', method: 'me.transactions', scope: 'credits:view', map: () => []},
    {label: 'Gifts'},
    {opcode: 'createGift', blockType: R, text: 'create a gift of [AMOUNT] credits', args: {AMOUNT: num(10)}, method: 'gifts.create', scope: 'gifts:create', sensitive: true, confirm: 'create a credit gift', map: a => [Number(a.AMOUNT) || 0]},
    {opcode: 'giftInfo', blockType: R, text: 'gift info for code [CODE]', args: {CODE: 'code'}, method: 'gifts.get', map: a => [a.CODE]},
    {opcode: 'claimGift', blockType: C, text: 'claim gift code [CODE]', args: {CODE: 'code'}, method: 'gifts.claim', scope: 'gifts:claim', sensitive: true, confirm: 'claim this gift', map: a => [a.CODE]},
    {opcode: 'cancelGift', blockType: C, text: 'cancel gift [ID]', args: {ID: 'id'}, method: 'gifts.cancel', scope: 'gifts:cancel', map: a => [a.ID]},
    {opcode: 'myGifts', blockType: R, text: 'gifts I created', method: 'gifts.mine', scope: 'gifts:view', map: () => []},
    {label: 'Stats'},
    {opcode: 'economyStats', blockType: R, text: 'network economy stats', method: 'stats.economy', map: () => []},
    {opcode: 'mostGained', blockType: R, text: 'top credit earners', method: 'stats.mostGained', map: () => []}
]);

const keys = ext('roturKeys', 'Rotur Keys', [
    {opcode: 'myKeys', blockType: R, text: 'my keys', method: 'keys.mine', scope: 'keys:view', map: () => []},
    {opcode: 'keyInfo', blockType: R, text: 'details of key [ID]', args: {ID: 'id'}, method: 'keys.get', map: a => [a.ID]},
    {opcode: 'userHasKey', blockType: B, text: 'does [USER] own key [KEY]?', args: {USER: 'username', KEY: 'key'}, method: 'keys.check', map: a => [a.USER, a.KEY], result: r => Boolean(r && (r.owns || r.owned || r.has))},
    {opcode: 'buyKey', blockType: C, text: 'buy key [ID]', args: {ID: 'id'}, method: 'keys.buy', sensitive: true, confirm: 'buy this key', map: a => [a.ID]},
    {opcode: 'cancelKey', blockType: C, text: 'cancel key [ID]', args: {ID: 'id'}, method: 'keys.cancel', sensitive: true, confirm: 'cancel this key', map: a => [a.ID]},
    {label: 'Manage my keys'},
    {opcode: 'renameKey', blockType: C, text: 'rename key [ID] to [NAME]', args: {ID: 'id', NAME: 'name'}, method: 'keys.rename', scope: 'keys:manage', map: a => [a.ID, a.NAME]},
    {opcode: 'updateKey', blockType: C, text: 'set key [ID] data to [DATA]', args: {ID: 'id', DATA: '{}'}, method: 'keys.update', scope: 'keys:manage', map: a => [a.ID, a.DATA]},
    {opcode: 'revokeKey', blockType: C, text: 'revoke key [ID]', args: {ID: 'id'}, method: 'keys.revoke', scope: 'keys:manage', map: a => [a.ID]},
    {opcode: 'deleteKey', blockType: C, text: 'delete key [ID]', args: {ID: 'id'}, method: 'keys.delete', scope: 'keys:manage', sensitive: true, confirm: 'delete this key', map: a => [a.ID]},
    {label: 'Project storage'},
    {opcode: 'saveData', blockType: C, text: 'save [VALUE] to project storage as [KEY]', args: {VALUE: '', KEY: 'key'}, storage: 'set', scope: 'storage:manage'},
    {opcode: 'loadData', blockType: R, text: 'project storage [KEY]', args: {KEY: 'key'}, storage: 'get', scope: 'storage:view'},
    {opcode: 'hasData', blockType: B, text: 'project storage has [KEY]?', args: {KEY: 'key'}, storage: 'has', scope: 'storage:view'},
    {opcode: 'deleteData', blockType: C, text: 'delete [KEY] from project storage', args: {KEY: 'key'}, storage: 'delete', scope: 'storage:delete'},
    {opcode: 'allDataKeys', blockType: R, text: 'all project storage keys', storage: 'keys', scope: 'storage:view'}
]);

const status = ext('roturStatus', 'Rotur Status', [
    {opcode: 'statusOf', blockType: R, text: "[USER]'s status", args: {USER: 'username'}, method: 'status.get', map: a => [a.USER], result: r => (r && r.status ? r.status : '')},
    {opcode: 'presenceOf', blockType: R, text: "[USER]'s presence", args: {USER: 'username'}, method: 'status.get', map: a => [a.USER], result: r => (r && r.presence ? r.presence : '')},
    {opcode: 'fullStatusOf', blockType: R, text: "[USER]'s full status", args: {USER: 'username'}, method: 'status.get', map: a => [a.USER], result: r => r},
    {label: 'My presence'},
    {opcode: 'setStatus', blockType: C, text: 'set my status to [TEXT] and presence to [PRESENCE]', args: {TEXT: 'hello', PRESENCE: menu('presence', 'online')}, method: 'socket.setStatus', scope: 'account:profile', map: a => [a.TEXT, a.PRESENCE]},
    {label: 'Rich presence'},
    {opcode: 'setGameActivity', blockType: C, text: 'show I am [VERB] this project', args: {VERB: 'Playing'}, activity: 'set', scope: 'account:profile'},
    {opcode: 'setGameActivityFull', blockType: C, text: 'show I am [VERB] this project doing [DETAILS] with image [IMAGE]', args: {VERB: 'Playing', DETAILS: 'in a match', IMAGE: ''}, activity: 'set', scope: 'account:profile'},
    {opcode: 'clearActivity', blockType: C, text: 'clear my activity', activity: 'clear', scope: 'account:profile'}
], {presence: ['online', 'idle', 'dnd', 'invisible']});

const social = ext('roturSocial', 'Rotur Social', [
    {opcode: 'post', blockType: C, text: 'make a post saying [CONTENT]', args: {CONTENT: 'hello world'}, method: 'posts.create', scope: 'posts:create', map: a => [a.CONTENT]},
    {opcode: 'feed', blockType: R, text: 'latest posts', method: 'posts.feed', map: () => []},
    {opcode: 'followingFeed', blockType: R, text: 'posts from people I follow', method: 'posts.followingFeed', scope: 'posts:view', map: () => []},
    {opcode: 'topPosts', blockType: R, text: 'top posts', method: 'posts.top', map: () => []},
    {opcode: 'searchPosts', blockType: R, text: 'search posts for [QUERY]', args: {QUERY: 'hello'}, method: 'posts.search', map: a => [a.QUERY]},
    {opcode: 'like', blockType: C, text: 'like post [ID]', args: {ID: 'id'}, method: 'posts.like', scope: 'posts:like', map: a => [a.ID]},
    {opcode: 'unlike', blockType: C, text: 'unlike post [ID]', args: {ID: 'id'}, method: 'posts.unlike', scope: 'posts:like', map: a => [a.ID]},
    {opcode: 'reply', blockType: C, text: 'reply to post [ID] saying [CONTENT]', args: {ID: 'id', CONTENT: 'nice'}, method: 'posts.reply', scope: 'posts:reply', map: a => [a.ID, a.CONTENT]},
    {opcode: 'repost', blockType: C, text: 'repost post [ID]', args: {ID: 'id'}, method: 'posts.repost', scope: 'posts:repost', map: a => [a.ID]},
    {opcode: 'deletePost', blockType: C, text: 'delete post [ID]', args: {ID: 'id'}, method: 'posts.delete', scope: 'posts:delete', sensitive: true, confirm: 'delete this post', map: a => [a.ID]},
    {label: 'Following'},
    {opcode: 'follow', blockType: C, text: 'follow [USER]', args: {USER: 'username'}, method: 'following.follow', scope: 'following:follow', map: a => [a.USER]},
    {opcode: 'unfollow', blockType: C, text: 'unfollow [USER]', args: {USER: 'username'}, method: 'following.unfollow', scope: 'following:unfollow', map: a => [a.USER]},
    {opcode: 'followersOf', blockType: R, text: 'followers of [USER]', args: {USER: 'username'}, method: 'following.followers', map: a => [a.USER]},
    {opcode: 'followingOf', blockType: R, text: 'who [USER] follows', args: {USER: 'username'}, method: 'following.following', map: a => [a.USER]},
    {label: 'Friends'},
    {opcode: 'friends', blockType: R, text: 'my friends', method: 'friends.list', scope: 'friends:view', map: () => []},
    {opcode: 'friendRequests', blockType: R, text: 'my incoming friend requests', method: 'me.requests', scope: 'friends:view', map: () => [], result: r => JSON.stringify((r && r.requests) || [])},
    {opcode: 'requestFriend', blockType: C, text: 'add [USER] as a friend', args: {USER: 'username'}, method: 'friends.request', scope: 'friends:request', map: a => [a.USER]},
    {opcode: 'acceptFriend', blockType: C, text: 'accept friend request from [USER]', args: {USER: 'username'}, method: 'friends.accept', scope: 'friends:accept', map: a => [a.USER]},
    {opcode: 'rejectFriend', blockType: C, text: 'reject friend request from [USER]', args: {USER: 'username'}, method: 'friends.reject', scope: 'friends:accept', map: a => [a.USER]},
    {opcode: 'removeFriend', blockType: C, text: 'remove [USER] from my friends', args: {USER: 'username'}, method: 'friends.remove', scope: 'friends:remove', map: a => [a.USER]}
]);

const shop = ext('roturShop', 'Rotur Shop', [
    {label: 'Items'},
    {opcode: 'item', blockType: R, text: 'item [NAME]', args: {NAME: 'name'}, method: 'items.get', map: a => [a.NAME]},
    {opcode: 'itemsForSale', blockType: R, text: 'items for sale', method: 'items.selling', map: () => []},
    {opcode: 'userItems', blockType: R, text: "[USER]'s items", args: {USER: 'username'}, method: 'items.list', map: a => [a.USER]},
    {opcode: 'buyItem', blockType: C, text: 'buy item [NAME]', args: {NAME: 'name'}, method: 'items.buy', scope: 'items:buy', sensitive: true, confirm: 'buy this item', map: a => [a.NAME]},
    {opcode: 'sellItem', blockType: C, text: 'put item [NAME] up for sale', args: {NAME: 'name'}, method: 'items.sell', scope: 'items:sell', map: a => [a.NAME]},
    {opcode: 'stopSelling', blockType: C, text: 'stop selling item [NAME]', args: {NAME: 'name'}, method: 'items.stopSelling', scope: 'items:sell', map: a => [a.NAME]},
    {opcode: 'setItemPrice', blockType: C, text: 'set price of item [NAME] to [PRICE]', args: {NAME: 'name', PRICE: num(1)}, method: 'items.setPrice', scope: 'items:sell', map: a => [a.NAME, Number(a.PRICE) || 0]},
    {opcode: 'giveItem', blockType: C, text: 'give item [NAME] to [USER]', args: {NAME: 'name', USER: 'username'}, method: 'items.transfer', scope: 'items:manage', sensitive: true, confirm: 'give away this item', map: a => [a.NAME, a.USER]},
    {label: 'Cosmetics'},
    {opcode: 'cosmeticShop', blockType: R, text: 'cosmetics shop', method: 'cosmetics.shop', map: () => []},
    {opcode: 'myCosmetics', blockType: R, text: 'my cosmetics', method: 'cosmetics.mine', scope: 'cosmetics:view', map: () => []},
    {opcode: 'buyCosmetic', blockType: C, text: 'buy cosmetic [ID]', args: {ID: 'id'}, method: 'cosmetics.purchase', scope: 'cosmetics:buy', sensitive: true, confirm: 'buy this cosmetic', map: a => [a.ID]},
    {opcode: 'equipCosmetic', blockType: C, text: 'equip cosmetic [ID]', args: {ID: 'id'}, method: 'cosmetics.equip', scope: 'cosmetics:equip', map: a => [a.ID]},
    {opcode: 'unequipCosmetic', blockType: C, text: 'unequip cosmetic type [TYPE]', args: {TYPE: 'hat'}, method: 'cosmetics.unequip', scope: 'cosmetics:equip', map: a => [a.TYPE]},
    {opcode: 'cosmeticsOf', blockType: R, text: "[USER]'s cosmetics", args: {USER: 'username'}, method: 'cosmetics.forUser', map: a => [a.USER]}
]);

const groups = ext('roturGroups', 'Rotur Groups', [
    {opcode: 'myGroups', blockType: R, text: 'groups I am in', method: 'groups.mine', scope: 'groups:view', map: () => []},
    {opcode: 'searchGroups', blockType: R, text: 'search groups for [QUERY]', args: {QUERY: 'name'}, method: 'groups.search', scope: 'groups:view', map: a => [a.QUERY]},
    {opcode: 'group', blockType: R, text: 'group [TAG]', args: {TAG: 'tag'}, method: 'groups.get', map: a => [a.TAG]},
    {opcode: 'joinGroup', blockType: C, text: 'join group [TAG]', args: {TAG: 'tag'}, method: 'groups.join', scope: 'groups:join', map: a => [a.TAG]},
    {opcode: 'requestJoinGroup', blockType: C, text: 'request to join group [TAG]', args: {TAG: 'tag'}, method: 'groups.requestJoin', scope: 'groups:join', map: a => [a.TAG]},
    {opcode: 'leaveGroup', blockType: C, text: 'leave group [TAG]', args: {TAG: 'tag'}, method: 'groups.leave', scope: 'groups:leave', map: a => [a.TAG]},
    {label: 'Group info'},
    {opcode: 'groupMembers', blockType: R, text: 'members of group [TAG]', args: {TAG: 'tag'}, method: 'groups.members', scope: 'groups:members.view', map: a => [a.TAG]},
    {opcode: 'groupRoles', blockType: R, text: 'roles in group [TAG]', args: {TAG: 'tag'}, method: 'groups.roles', scope: 'groups:view', map: a => [a.TAG]},
    {opcode: 'groupAnnouncements', blockType: R, text: 'announcements in group [TAG]', args: {TAG: 'tag'}, method: 'groups.announcements', map: a => [a.TAG]},
    {opcode: 'groupEvents', blockType: R, text: 'events in group [TAG]', args: {TAG: 'tag'}, method: 'groups.events', scope: 'groups:view', map: a => [a.TAG]},
    {label: 'Group economy'},
    {opcode: 'groupProducts', blockType: R, text: 'products in group [TAG]', args: {TAG: 'tag'}, method: 'groups.products', scope: 'groups:view', map: a => [a.TAG]},
    {opcode: 'tipGroup', blockType: C, text: 'tip [AMOUNT] credits to group [TAG]', args: {AMOUNT: num(1), TAG: 'tag'}, method: 'groups.sendTip', scope: 'credits:manage', sensitive: true, confirm: 'tip this group', map: a => [a.TAG, Number(a.AMOUNT) || 0]},
    {opcode: 'buyGroupProduct', blockType: C, text: 'buy product [PRODUCT] in group [TAG]', args: {PRODUCT: 'id', TAG: 'tag'}, method: 'groups.purchaseProduct', scope: 'credits:manage', sensitive: true, confirm: 'buy this product', map: a => [a.TAG, a.PRODUCT]}
]);

const files = ext('roturFiles', 'Rotur Files', [
    {opcode: 'myFiles', blockType: R, text: 'my files', method: 'files.index', scope: 'files:view', map: () => []},
    {opcode: 'fileAtPath', blockType: R, text: 'file at path [PATH]', args: {PATH: '/file.txt'}, method: 'files.getByPath', scope: 'files:view', map: a => [a.PATH]},
    {opcode: 'fileById', blockType: R, text: 'file with id [UUID]', args: {UUID: 'uuid'}, method: 'files.getByUUID', scope: 'files:view', map: a => [a.UUID]},
    {opcode: 'storageUsage', blockType: R, text: 'my storage usage', method: 'files.usage', scope: 'files:view', map: () => []}
]);

module.exports = {
    RoturAccount: account,
    RoturEconomy: economy,
    RoturKeys: keys,
    RoturStatus: status,
    RoturSocial: social,
    RoturShop: shop,
    RoturGroups: groups,
    RoturFiles: files
};
