## syncup is backup service written in nodeJs and its working on windows/linux.
* it will take a zip archive from your specified directories and send it to specified ftp or just keeping it local (based on your setting in ./config.json) 
* you can schedule your backups (CRON Job like * * * * *)
   using https://github.com/node-schedule/node-schedule
* its integrated with telegram so you can command it from your telegram bot
using https://github.com/yagop/node-telegram-bot-api 

### Telegram integration
* use one bot per server
* you need to register your telegram account using [systemName] register [telegramBotKey] 
* it use long polling so no weebHook required

Command | Description
------------ | -------------
[systemName] register [telegramBotKey] | registering device on syncup service
[systemName] servicestart | start windows service
[systemName] serviceinstall | install windows service
[systemName] servicestop | stop windows service
[systemName] serviceuninstall | uninstall windows service
[systemName] reloadconfig | it will reload config.json 
echo | simple echo to check telegram integration

### sample config file
* edit 'config-sample.json' and rename it to 'config.json'
```json
{
  "folders": [
    {
      "enabled": true,
      "name": "docs",
      "path": "D:\\docs",
      "exclude": [ "Projects Data", "Scaned Documents" ],
      "scheduling": [ "* 0 * * *", "* 12 * * *" ],
      "ftpId": 1,
      "ftpEnabled": true,
      "keepLocal": true,
      "emptyOnDone": true,
      "RunProcessBefore": [
        {
          "enabled": true,
          "path": "D:\\SqlBackuper\\backuper.console.exe",
          "timeout": 10000,
          "closeOnStdout": "ok",
          "waitToFinish": true
        }
      ],
      "RunProcessAfter": [
        {
          "enabled": false,
          "path": "",
          "timeout": 60000
        }
      ]
    }
  ],
  "ftps": [
    {
      "id": 1,
      "host": "192.168.2.100",
      "user": "remoteBackupUser",
      "password": "123",
      "port": 21,
      "home": "SERVER 1"
    }
  ],
  "settings": {
    "systemName": "laptop",
    "telegramBotToken": "Get from @botFather",
    "telegramBotKey": "123",
    "telegramUsers": [
    ],
    "service": {
      "enabled": false,
      "name": "Syncup",
      "description": "Will backup for you !"
    }
  }
}


