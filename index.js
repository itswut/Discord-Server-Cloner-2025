const { Client } = require('discord.js-selfbot-v13');

const client = new Client();

const CONFIG = {
	SOURCE_GUILD_ID: "185647255028629505", // Replace ID of the server you want to copy
	TARGET_GUILD_ID: "1340068750191497276", // Replace ID of the server you want to paste to
	TOKEN: "", // Your discord token
	options: {
		deleteExisting: true, // Delete all existing roles, channels, and emojis in the target server
        copyServerInfo: { // Copy server name, icon, server banner(if nitro level high enough), etc.
            enabled: true,
            name: true,
            icon: true,
            banner: true,
        },
		copyRoles: true, // Copy roles from the source server
		copyCategories: true, // Copy categories and channels from the source server
		copyEmojis: true // Copy emojis from the source server
	}
};

client.on('rateLimit', (info) => {
	console.log(`⏳ Rate limited! Details:`, info);
	client.destroy();
});

client.once('ready', async () => {
	console.log(`✅ Logged in as ${client.user.tag}`);

	const sourceGuild = client.guilds.cache.get(CONFIG.SOURCE_GUILD_ID);
	const targetGuild = client.guilds.cache.get(CONFIG.TARGET_GUILD_ID);

	if (!sourceGuild || !targetGuild) {
		console.log('❌ Source or target server not found.');
		return client.destroy();
	}

	console.log(`🔄 Cloning ${sourceGuild.name} → ${targetGuild.name}...`);

	try {
		if (CONFIG.options.deleteExisting) await deleteExistingData(targetGuild);
		let roleMap = new Map();
		if (CONFIG.options.copyRoles) roleMap = await copyRoles(sourceGuild, targetGuild);
		if (CONFIG.options.copyCategories) await copyCategories(sourceGuild, targetGuild, roleMap);
		if (CONFIG.options.copyEmojis) await copyEmojis(sourceGuild, targetGuild);
        if (CONFIG.options.copyServerInfo) await copyServerInfo(sourceGuild, targetGuild);

		console.log('✅ Cloning completed successfully.');
	} catch (error) {
		console.log('❌ Error occurred during cloning:', error);
	} finally {
		client.destroy();
	}
});

async function deleteExistingData(guild) {
	console.log('🗑️ Deleting existing data...');
	try {
		const deletePromises = [];

		guild.roles.cache.forEach(role => {
			if (!role.managed && role.name !== '@everyone') {
				deletePromises.push(role.delete().catch(err => console.log(`❌ Failed to delete role: ${role.name}`)));
			}
		});

		guild.channels.cache.forEach(channel => {
			deletePromises.push(channel.delete().catch(err => console.log(`❌ Failed to delete channel: ${channel.name}`)));
		});

		guild.emojis.cache.forEach(emoji => {
			deletePromises.push(emoji.delete().catch(err => console.log(`❌ Failed to delete emoji: ${emoji.name}`)));
		});

		await Promise.all(deletePromises);
	} catch (error) {
		console.log('❌ Error deleting existing data:', error);
	}
}

function fetchChannelPermissions(channel) {
	return channel.permissionOverwrites.cache.map(overwrite => ({
		id: overwrite.id,
		type: overwrite.type,
		allow: overwrite.allow.bitfield,
		deny: overwrite.deny.bitfield
	}));
}

async function copyServerInfo(sourceGuild, targetGuild) {
    console.log('📝 Copying server info...');
    try {
        if (CONFIG.options.copyServerInfo.name) await targetGuild.setName(sourceGuild.name);
        if (CONFIG.options.copyServerInfo.icon) {
            const icon = await sourceGuild.iconURL({ dynamic: true, size: 4096 });
            await targetGuild.setIcon(icon);
        }
        if (CONFIG.options.copyServerInfo.banner) {
            const banner = await sourceGuild.bannerURL({ dynamic: true, size: 4096 });
            if (banner) await targetGuild.setBanner(banner);
        }
        console.log('✅ Copied server info.');
    } catch (error) {
        console.log(`❌ Failed to copy server info: ${error.message}`);
    }
}

async function copyRoles(sourceGuild, targetGuild) {
	console.log('🔒 Copying roles...');
	const roleMap = new Map();

	const roles = sourceGuild.roles.cache.sort((a, b) => a.position - b.position);
	for (const role of roles.values()) {
		if (role.name === '@everyone') continue;

		try {
			const newRole = await targetGuild.roles.create({
				name: role.name,
				color: role.color,
				hoist: role.hoist,
				mentionable: role.mentionable,
				permissions: role.permissions.bitfield & ~(8n),
			});

			roleMap.set(role.id, newRole.id);
			console.log(`✅ Cloned role: ${role.name}`);
		} catch (error) {
			console.log(`❌ Failed to clone role: ${role.name} - ${error.message}`);
		}
	}
	return roleMap;
}

async function copyEmojis(sourceGuild, targetGuild) {
	console.log('\n😀 Copying emojis...');

	for (const emoji of sourceGuild.emojis.cache.values()) {
		try {
			await targetGuild.emojis.create(emoji.url, emoji.name);
			console.log(`✅ Cloned emoji: ${emoji.name}`);
		} catch (error) {
			console.log(`❌ Failed to clone emoji: ${emoji.name} - ${error.message}`);
		}
	}
}

function remapPermissions(overwrites, roleMap) {
	return overwrites.map(overwrite => {
		if (roleMap.has(overwrite.id)) {
			overwrite.id = roleMap.get(overwrite.id);
		}
		return overwrite;
	});
}

async function copyCategories(sourceGuild, targetGuild, roleMap) {
	console.log('📂 Copying categories...');
	try {
		const categories = sourceGuild.channels.cache.filter(c => c.type === "GUILD_CATEGORY").sort((a, b) => a.position - b.position);

		for (const category of categories.values()) {
			console.log(`📁 Copying category: ${category.name}`);
			const overwrites = fetchChannelPermissions(category);
			const remappedOverwrites = remapPermissions(overwrites, roleMap);

			const everyoneOverwrite = overwrites.find(o => o.id === sourceGuild.id);
			if (everyoneOverwrite) {
				remappedOverwrites.push({
					id: targetGuild.id,
					type: 'role',
					allow: everyoneOverwrite.allow,
					deny: everyoneOverwrite.deny
				});
			}

			const newCategory = await targetGuild.channels.create(category.name, {
				type: "GUILD_CATEGORY",
				permissionOverwrites: remappedOverwrites
			});

			const channels = sourceGuild.channels.cache.filter(c => c.parentId === category.id).sort((a, b) => a.position - b.position);
			for (const channel of channels.values()) {
				console.log(`📝 Copying channel: ${channel.name}`);
				const channelOverwrites = fetchChannelPermissions(channel);
				const remappedChannelOverwrites = remapPermissions(channelOverwrites, roleMap);
				const everyoneChannelOverwrite = channelOverwrites.find(o => o.id === sourceGuild.id);
				if (everyoneChannelOverwrite) {
					remappedChannelOverwrites.push({
						id: targetGuild.id,
						type: 'role',
						allow: everyoneChannelOverwrite.allow,
						deny: everyoneChannelOverwrite.deny
					});
				}

				await targetGuild.channels.create(channel.name, {
					type: channel.type,
					parent: newCategory,
					permissionOverwrites: remappedChannelOverwrites
				});
			}

			console.log(`✅ Created category: ${category.name}`);
		}
	} catch (error) {
		console.log(`❌ Failed to copy categories: ${error.message}`);
	}
}

if (!CONFIG.TOKEN) {
	console.log('❌ Discord token is missing. Please set it in a .env file.');
	process.exit(1);
}

client.login(CONFIG.TOKEN).catch(error => {
	console.log('❌ Failed to log in:', error);
});