import sql3 from "sqlite3";

type CONFIG_DATA = {
    name: string;
    value: string
}

type CONFIG_VALUE = {
    value: string
}

export default class DB_Config {
    private db: sql3.Database;
    constructor(db: sql3.Database) {
        this.db = db;
    }

    getByNameWithValue(data: CONFIG_DATA[]) {

    }

    getValueByName(name: string): Promise<CONFIG_VALUE[]> {
        return new Promise((resolve, reject) => {
            this.db.serialize(() => {
                this.db.all(`SELECT value FROM config WHERE name = "${name}"`, (error, rows) => {
                    if (error) reject(error);
                    resolve(rows);
                })
            })
        })
    }

}
