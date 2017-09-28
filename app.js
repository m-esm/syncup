var fs = require('fs-extra');
var _ = require('underscore');
var moment = require('moment');
var zip = require('zip-folder');
var Q = require('q');
var path = require('path');
var ftpClient = require('ftp');

var schedule = require('node-schedule');
var isWin = /^win/.test(process.platform);

var archiver = require('archiver');
var TelegramBot = require('node-telegram-bot-api');
var exec = require('child_process').exec;
var guid = require('guid');

const express = require('express')
const app = express()

fs.ensureDir('./download')
    .then(() => {

        app.use(express.static('download'))

        app.get('/', function (req, res) {
            res.send(':)').end();
        });


        app.listen(6767, function () {
            clog('syncup http server running on port 6767')
        });

    })
    .catch(err => {
        clog(err)
    })


var config = {};
var telegramBot = false;
var clog = function (input, folder) {

    console.log(input);
    if (telegramBot)
        if (config.settings.telegramUsers)
            config.settings.telegramUsers.forEach(function (tgUser, chatIndex) {
                if (tgUser.isAdmin)
                    telegramBot.sendMessage(tgUser.id, input.toString());

                if (!tgUser.isAdmin)
                    if (folder && tgUser.folders)
                        if (tgUser.folders.indexOf(folder.name) != -1)
                            telegramBot.sendMessage(tgUser.id, input.toString());


            });

};

var handleError = function (err) {

    clog('handleError => ' + err, null);

};


var zipItem = function (itemPath, itemName, zipPath, folderItem) {
    var deferred = Q.defer();

    var output = fs.createWriteStream(zipPath);
    var archive = archiver('zip');

    output.on('close', function () {

        if (folderItem.log)
            clog('archiver done => ' + zipPath + '\n' + archive.pointer() + ' total bytes', folderItem);

        deferred.resolve();

    });

    archive.on('error', function (err) {
        throw err;
    });

    archive.pipe(output);

    if (fs.lstatSync(itemPath).isDirectory()) {
        archive.directory(itemPath + '/', itemName);

    } else {
        archive.file(itemPath, { name: itemName });
    }

    archive.finalize();




    return deferred.promise;

};
var ZipItems = function (folderItem, items, tempPath) {


    var deferred = Q.defer();

    fs.ensureDir(tempPath, err => {
        if (err)
            return handleError(err);

        var zipItemPromiseArray = [];

        items.forEach(function (item, itemIndex) {

            if (folderItem.exclude.indexOf(item) != -1)
                return;

            var itemPath = folderItem.path + (isWin ? '\\' : '/') + item;
            var zipPath = tempPath + '/' + item + '.zip';

            zipItemPromiseArray.push(zipItem(itemPath, item, zipPath, folderItem));

        });

        Q.all(zipItemPromiseArray).then(function () {

            deferred.resolve();
            if (folderItem.log)
                clog('all files ziped from ' + folderItem.path + ' to ' + tempPath);

        });

    });

    return deferred.promise;


};

var runProcess = function (process) {

    var deferred = Q.defer();

    var child = exec(process.path);

    if (process.timeout > 0)
        setTimeout(function () {
            child.kill();
        }, process.timeout);

    child.stdout.on('data', function (data) {

        data = data.toLowerCase().trim();

        if (process.log)
            clog(process.path + ' => stdout: ' + data);

        if (data == process.closeOnStdout.trim().toLowerCase()) {
            child.kill();
        }

    });

    child.stderr.on('data', function (data) {
        if (process.log)
            clog('data from process ' + process.path + ' ' + data.toString());


    });

    child.on('close', function (code) {

        if (process.log)
            clog(process.path + ' closing code: ' + code);
        deferred.resolve();

    });

    return deferred.promise;

};

var sendZipToFtp = function (folderItem, zipPath) {

    var deferred = Q.defer();

    var remoteFtp = _.findWhere(config.ftps, {
        id: folderItem.ftpId
    });

    if (!remoteFtp)
        deferred.catch();

    var c = new ftpClient();

    var putIt = function () {
        c.put(zipPath, path.basename(zipPath), function (err) {

            if (err)
                return handleError(err);

            clog(zipPath + '=> transfered to ' + remoteFtp.host);

            c.end();

            if (!folderItem.keepLocal)
                fs.remove(zipPath).then(function () {

                    deferred.resolve();

                });
        });
    };

    var setCwd = function (callback) {

        c.cwd(remoteFtp.home, function (err) {
            if (err)
                return handleError(err);

            putIt();

        });

    };

    var createHome = function (callback) {
        c.mkdir(remoteFtp.home, function (err) {

            if (err)
                return handleError(err);

            callback();

        });
    };


    c.on('ready', function () {
        c.list(function (err, list) {
            if (err)
                return handleError(err);

            if (!_.findWhere(list, {
                name: remoteFtp.home
            })) {
                createHome(setCwd);
            } else {
                setCwd();
            }

        });

    });

    c.on('error', function (err) {
        if (err)
            return handleError(err);
    });
    // connect to localhost:21 as anonymous
    c.connect(remoteFtp);

    return deferred.promise;

};

var backupFolder = function (folderItem, mode) {


    if (!folderItem.enabled)
        return;

    if (!mode)
        mode = "ftp";

    clog('backup process started for ' + folderItem.name, folderItem);

    var deferred = Q.defer();

    var BeforeRunProcPromiseArray = [];
    folderItem.RunProcessBefore.forEach(function (proc, index) {

        if (proc.enabled)
            if (proc.waitToFinish)
                BeforeRunProcPromiseArray.push(runProcess(proc));
            else
                runProcess(proc);

    });

    var AfterRunProcPromiseArray = [];
    folderItem.RunProcessAfter.forEach(function (proc, index) {
        if (proc.enabled)
            AfterRunProcPromiseArray.push(runProcess(proc));
    });

    Q.all(BeforeRunProcPromiseArray).then(function () {

        fs.readdir(folderItem.path, function (err, readRes) {

            if (err)
                return handleError(err);

            if (folderItem.include)
                if (folderItem.include.length > 0)
                    readRes = folderItem.include;


            var timeString = moment().format('YYYY-MM-DD_hh-mm-ss');

            var tempPath = './backups/' + folderItem.name + '_' + timeString;

            ZipItems(folderItem, readRes, tempPath).then(function () {

                var zipPath = tempPath + ".zip";

                zip(tempPath, zipPath, function (err) {

                    if (err)
                        return handleError(err);

                    clog('final zip created => ' + zipPath, folderItem);

                    if (mode == "ftp")
                        if (folderItem.ftpEnabled)
                            sendZipToFtp(folderItem, zipPath);

                    if (mode == "telegram")
                        if (telegramBot)
                            if (config.settings.telegramUsers)
                                config.settings.telegramUsers.forEach(function (tgUser, chatIndex) {
                                    telegramBot.sendDocument(tgUser.id, zipPath).then(function () {
                                        fs.remove(zipPath);
                                    }, function (err) {
                                        clog(err, folderItem);
                                    });
                                });

                    if (mode == "download") {

                        var destFileName = config.settings.systemName + '_' + path.basename(zipPath, 'zip') + '_' + guid.raw() + '.zip';
                        var destPath = './download/' + destFileName;

                        fs.move(zipPath, destPath);

                        clog('Your requested backup is ready and it will automatically deleted in 2 hours http://' + config.settings.systemAddr + ':6767/' + destFileName, folderItem);

                        setTimeout(function () {
                            fs.remove(destPath);
                        }, 1000 * 60 * 60 * 2);

                    }

                    if (folderItem.emptyOnDone)
                        fs.emptyDir(folderItem.path, err => {
                            if (err) return console.error(err)

                            clog('folder emptyed ! ' + folderItem.path, folderItem);
                        });

                    fs.remove(tempPath);
                    Q.all(AfterRunProcPromiseArray);
                    deferred.resolve();

                });

            });






        });


    });



    return deferred.promise;
};


var backupAll = function (mode) {

    clog('backup process started ...');
    var backupFolderPromiseArray = [];

    config.folders.forEach(function (folderItem, index) {

        //var regExp = /\(([^)]+)\)/;
        //var matches = regExp.exec(folderItem.path);
        //if (matches)
        //    folderItem.path = folderItem.path.replace(matches[0], moment().format(matches[1]));

        backupFolderPromiseArray.push(backupFolder(folderItem, mode));

    });

    var deferred = Q.defer();

    Q.all(backupFolderPromiseArray).then(function () {

        deferred.resolve();

    });


    return deferred.promise;

};



// reading config and starting
fs.readJson('./config.json', function (err, _config) {

    config = _config;

    if (err)
        return handleError(err);

    var svc = {};


    console.info('config loaded =>', config);

    if (isWin) {
        var Service = require('node-windows').Service;
        svc = new Service({
            name: config.settings.service.name,
            description: config.settings.service.description,
            script: __filename,
            env: {
                name: "servicejob",
                value: true
            },
            abortOnError: true
        });

        svc.on('install', function () {
            clog('service installed !');
        });
        svc.on('alreadyinstalled', function () {
            clog('service already installed !');
        });
        svc.on('uninstall', function () {
            clog('service Uninstall complete !');
        });

        svc.on('start', function () {
            clog('service started !');
        });

        svc.on('stop', function () {
            clog('service stopped !');
        });

        svc.on('error', function (err) {
            clog('service error ' + err.toString());
        });


    }


    telegramBot = new TelegramBot(config.settings.telegramBotToken, { polling: true });

    telegramBot.on('message', (msg) => {

        var chatId = msg.chat.id;
        var msgText = msg.text.toLowerCase().trim();
        var msgParts = msgText.split(' ');

        var tgUser = _.findWhere(config.settings.telegramUsers, { id: msg.chat.id });

        if (msgParts[0] == "unregister") {

            config.settings.telegramUsers = _.filter(config.settings.telegramUsers, function (item) {
                if (item.id != chatId)
                    return true;
            });

            fs.writeJson('./config.json', config)
                .then(() => {
                    telegramBot.sendMessage(chatId, 'You have unregistered from ' + config.settings.systemName + ' syncup system');
                })
                .catch(err => {
                    telegramBot.sendMessage(chatId, 'save config failed ! try again ...');
                })

        }


        if (msgParts[0] == "register") {

            clog('register request from ' + JSON.stringify(msg.chat));

            if (tgUser)
                telegramBot.sendMessage(chatId, 'you are already registered / use unregister for removing your account' + JSON.stringify(tgUser));
            else {
                config.settings.telegramUsers.push(
                    _.extend(msg.chat, { folders: [], isAdmin: msgParts[1] == config.settings.telegramBotKey }));
                fs.writeJson('./config.json', config)
                    .then(() => {
                        telegramBot.sendMessage(chatId, 'You have registered to ' + config.settings.systemName + ' syncup system');
                    })
                    .catch(err => {
                        telegramBot.sendMessage(chatId, 'save config failed ! try again ...');
                    })
            }
        }

        if (tgUser) {


            if (msgParts[0] == "showconfig")
                if (tgUser.isAdmin)
                    clog(JSON.stringify(config));


            if (msgParts[0] == "myfolders") {
                if (tgUser.isAdmin) {
                    clog(JSON.stringify(_.map(config.folders, function (item) {
                        return item.name;
                    })));
                } else {
                    telegramBot.sendMessage(chatId, JSON.stringify(tgUser.folders));
                }
            }

            if (msgParts[0] == "backup") {
                if (msgParts[1] == "all" && tgUser.isAdmin)
                    backupAll(msgParts[2]);
                else {

                    var folderItem = _.findWhere(config.folders, {
                        name: msgParts[1]
                    });


                    if (folderItem) {

                        if (tgUser.isAdmin || tgUser.folders.indexOf(folderItem.name) != -1) {

                            clog('backup requested for ' + folderItem.name + ' from ' + tgUser.username);

                            backupFolder(folderItem, msgParts[2]);
                        }
                        else {
                            telegramBot.sendMessage(chatId, 'folder is not yours ...');
                        }

                    }
                    else
                        telegramBot.sendMessage(chatId, 'run what ? (ex : [systemName] run [folderName])');
                }
            }

            if (tgUser.isAdmin) {

                if (msgParts[0] == "addfolder") {

                    config.settings.telegramUsers = _.map(config.settings.telegramUsers, function (item) {
                        if (item.username.toLowerCase() == msgParts[1].toLowerCase())
                            item.folders.push(msgParts[2]);

                        return item;
                    });

                    fs.writeJson('./config.json', config)
                        .then(() => {
                            telegramBot.sendMessage(chatId, 'config save for ' + config.settings.systemName + ' syncup system');
                        })
                        .catch(err => {
                            telegramBot.sendMessage(chatId, 'save config failed ! try again ...');
                        });

                }

                if (msgParts[0] == "delfolder") {

                    config.settings.telegramUsers = _.map(config.settings.telegramUsers, function (item) {

                        if (item.username.toLowerCase() == msgParts[1].toLowerCase())
                            item.folders = _.filter(item.folders, function (ff) {
                                return ff != msgParts[2];
                            });

                        return item;
                    });

                    fs.writeJson('./config.json', config)
                        .then(() => {
                            telegramBot.sendMessage(chatId, 'config save for ' + config.settings.systemName + ' syncup system');
                        })
                        .catch(err => {
                            telegramBot.sendMessage(chatId, 'save config failed ! try again ...');
                        });

                }


                if (msgParts[0] == "listusers")
                    clog(JSON.stringify(config.settings.telegramUsers));



                if (msgParts[0] == "reloadconfig")
                    fs.readJson('./config.json', function (err, _config) {
                        config = _config;
                    });

                if (msgParts[0].startsWith("service"))
                    if (isWin) {

                        if (msgParts[0] == "servicestart")
                            svc.start();

                        if (msgParts[0] == "serviceinstall")
                            svc.install();

                        if (msgParts[0] == "servicestop")
                            svc.stop();

                        if (msgParts[0] == "serviceuninstall")
                            svc.uninstall();

                    } else {
                        clog('Operation need windows os You are using ' + process.platform);
                    }
            }
        }



        if (msgParts[0] == "echo") {
            telegramBot.sendMessage(chatId, 'Echo from ' + config.settings.systemName);
        }


    });




    if (process.env.servicejob == "true" || config.settings.service.enabled == false) {

        if (process.env.servicejob == "true")
            config.folders.forEach(function (folderItem, index) {

                folderItem.scheduling.forEach(function (sched, index) {
                    schedule.scheduleJob(sched, function () {
                        backupFolder(folderItem)
                    });
                });

            });


    } else {


        svc.install();

    }



});
