var fs = require('fs-extra');
var _ = require('underscore');
var moment = require('moment');
var zip = require('zip-folder');
var Q = require('q');
var path = require('path');
var ftpClient = require('ftp');
var Service = require('node-windows').Service;
var schedule = require('node-schedule');
var EventLogger = require('node-windows').EventLogger;
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


var log = {};
var config = {};
var telegramBot = false;
var clog = function (input) {

    console.log(input);
    if (telegramBot)
        if (config.settings.telegramUsers)
            config.settings.telegramUsers.forEach(function (tgUser, chatIndex) {
                telegramBot.sendMessage(tgUser.id, input.toString());
            });

};

var handleError = function (err) {

    clog('handleError => ', err);
    log.error(err.toString());

};


var zipItem = function (itemPath, itemName, zipPath) {
    var deferred = Q.defer();

    var output = fs.createWriteStream(zipPath);
    var archive = archiver('zip');

    output.on('close', function () {

        //   clog('archiver done => ' + zipPath + '\n' + archive.pointer() + ' total bytes');

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

            var itemPath = folderItem.path + '\\' + item;
            var zipPath = tempPath + '/' + item + '.zip';

            zipItemPromiseArray.push(zipItem(itemPath, item, zipPath));

        });

        Q.all(zipItemPromiseArray).then(function () {

            deferred.resolve();

            //    clog('all files ziped from ' + folderItem.path + ' to ' + tempPath);

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

    clog('backup process started for ' + folderItem.name);

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

                    clog('final zip created => ' + zipPath);

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
                                        clog(err);
                                    });
                                });

                    if (mode == "download") {

                        var destFileName = config.settings.systemName + '_'+ path.basename(zipPath, 'zip') + '_' + guid.raw() + '.zip';
                        var destPath = './download/' + destFileName;

                        fs.move(zipPath, destPath);

                        clog('Your requested backup is ready and it will automatically deleted in 24 hours http://' + config.settings.systemAddr + ':6767/' + destFileName);

                        setTimeout(function () {
                            fs.remove( destPath);
                        }, 1000 * 60 * 60 * 24);

                    }

                    if (folderItem.emptyOnDone)
                        fs.emptyDir(folderItem.path, err => {
                            if (err) return console.error(err)

                            clog('folder emptyed ! ' + folderItem.path);
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

    console.info('config loaded =>', config);

    var svc = new Service({
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


    log = new EventLogger(config.settings.service.name);



    telegramBot = new TelegramBot(config.settings.telegramBotToken, { polling: true });

    telegramBot.on('message', (msg) => {

        var chatId = msg.chat.id;
        var msgText = msg.text.toLowerCase().trim();
        var msgParts = msgText.split(' ');
        if (msgParts[0] == config.settings.systemName.toLowerCase()) {

            var tgUser = _.findWhere(config.settings.telegramUsers, { id: msg.chat.id });

            if (msgParts[1] == "register") {
                if (msgParts[2] == config.settings.telegramBotKey) {
                    config.settings.telegramUsers = [];
                    config.settings.telegramUsers.push(msg.chat);
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

                if (msgParts[1] == "backup") {
                    if (msgParts[2] == "all")
                        backupAll(msgParts[3]);
                    else {
                        var folderItem = _.findWhere(config.folders, {
                            name: msgParts[2]
                        });


                        if (folderItem)
                            backupFolder(folderItem, msgParts[3]);
                        else
                            clog('run what ? (ex : [systemName] run [folderName])');
                    }
                }


                if (msgParts[1] == "reloadconfig")
                    fs.readJson('./config.json', function (err, _config) {
                        config = _config;
                    });


                if (msgParts[1] == "servicestart")
                    svc.start();

                if (msgParts[1] == "serviceinstall")
                    svc.install();

                if (msgParts[1] == "servicestop")
                    svc.stop();

                if (msgParts[1] == "serviceuninstall")
                    svc.uninstall();

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
