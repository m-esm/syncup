//--- Begin Batch File ---//
:: Creates a backup of all databases in MySQL and puts them in seperate .sql files.
:: By Jon Lucas.

:: Name of the database user
set dbuser=root

:: Password for the database user
set dbpass=MokhChe0214470

:: Switch to the data directory to enumerate the folders
pushd "C:\ProgramData\MySQL\MySQL Server 5.7\Data"

echo "hello"
:: Loop through the data structure in the data dir to get the database names

FOR /D %%F IN (*) DO (
"C:\Program Files\MySQL\MySQL Server 5.7\bin\mysqldump.exe" --user=%dbuser% --password=%dbpass% --databases %%F > "E:\TempBackups\mysql_backups\%%F.sql"
)
