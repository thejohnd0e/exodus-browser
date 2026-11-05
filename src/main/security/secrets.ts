export interface Secrets {seal(value:string):Buffer;open(value:Buffer):string}
interface Storage {isEncryptionAvailable():boolean;encryptString(s:string):Buffer;decryptString(b:Buffer):string}
export class SecretStore implements Secrets {
  constructor(private storage:Storage){}
  seal(value:string){if(!this.storage.isEncryptionAvailable())throw Error('OS_ENCRYPTION_UNAVAILABLE');return this.storage.encryptString(value);}
  open(value:Buffer){if(!this.storage.isEncryptionAvailable())throw Error('OS_ENCRYPTION_UNAVAILABLE');return this.storage.decryptString(value);}
}
