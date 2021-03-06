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
* be aware of telegram file size limitation when using telegram command 

Command | Description
------------ | -------------
backup all [telegram,download,ftp] | will get backup of all enabled folders
backup [folderName] [telegram,download,ftp] | will get backup of specified folder 
myfolders | shows your owned folders 
listusers | list registered telegram users if you are admin
register [telegramBotKey] | registering on syncup service ( change isAdmin to true in config > telegramUsers for admin access)
unregister  | removing account from syncup service
servicestart | start windows service
serviceinstall | install windows service
servicestop | stop windows service
serviceuninstall | uninstall windows service
reloadconfig | it will reload config.json 
echo | simple echo to check telegram integration
### To do
* [x] test on linux
* [x] sending backups with telegram
* [x] using telegram to send backup uniq download link
* [ ] plugins ( backup helpers ex : mysql dumper , mongodb dumper , etc ... )
* Tell me what u need :)
#### Contact me
* mail me at <m-esm@hotmail.com>
* http://telegram.me/Shell24


### sample config file
* edit 'config-sample.json' and rename it to 'config.json'
```json
{
  "folders": [
    {
      "enabled": true,
      "name": "mongodb",
      "path": "E:\\mongodb_backups",
      "exclude": [ ],
      "scheduling": [ "* 0 * * *", "* 12 * * *" ],
      "ftpId": 1,
      "ftpEnabled": true,
      "keepLocal": true,
      "emptyOnDone": true,
      "RunProcessBefore": [
        {
          "enabled": true,
          "path": "C:\\mongodb\\backup.bat",
          "timeout": 10000,
          "closeOnStdout": "ok",
          "waitToFinish": true,
          "log": false
        }
      ],
      "RunProcessAfter": [
        {
          "enabled": false,
          "path": "",
          "timeout": 60000,
          "closeOnStdout": "ok"
        }
      ]
    },
    {
      "enabled": true,
      "name": "sql2014",
      "path": "D:\\backups",
      "exclude": [ ],
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
          "waitToFinish": true,
          "log": false

        }
      ],
      "RunProcessAfter": [
        {
          "enabled": false,
          "path": "",
          "timeout": 60000,
          "closeOnStdout": "ok"
        }
      ]
    }
  ],
  "ftps": [
    {
      "id": 1,
      "host": "192.168.1.100",
      "user": "ftpUser",
      "password": "123",
      "port": 21,
      "home": "Laptop"
    }
  ],
  "settings": {
    "systemName": "laptop",
    "telegramBotToken": "Get from bot father !",
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
