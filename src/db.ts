import {Pool} from 'pg';

const pool = new Pool ({
    database:'mini_ad_exchange',
});
export default pool;