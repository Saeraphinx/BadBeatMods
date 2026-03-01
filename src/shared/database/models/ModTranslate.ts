import { InferAttributes, InferCreationAttributes, Model } from "sequelize";
import { Mod } from "./Mod.ts";
import { Language, ModAPIPublicResponse, ModTranslateAPIPublicResponse, ModTranslateObject, ModTranslateType } from "../DBHelper.ts";

// translator can edit the mod translates directly
// suggester can add a translate suggest
// currently everyone can be a suggester, no permission limit

export class ModTranslate extends Model<InferAttributes<ModTranslate>, InferCreationAttributes<ModTranslate>> {
    // we have 3 primary key for a mod translate item
    declare readonly modId: number;
    declare readonly langCode: Language;
    declare readonly translateType: ModTranslateType;
    
    declare translate: string | null;
    declare translateRef: string | null;

    declare suggest: string | null;
    declare suggestRef: string | null;

    declare translatorModifiedUserId: number | null;
    declare translatorUserIds: number[];
    declare suggesterUserIds: number[];

    // declare approved:boolean

    public static toReferenceString(originalString:string):string {
        // FIXME: returns hash code of original string is enough
        return originalString;
    }

    public getStr(mod:Mod):string {
        switch (this.translateType) {
            case ModTranslateType.Name:
                return mod.name;
            case ModTranslateType.Summary:
                return mod.summary;
            case ModTranslateType.Description:
                return mod.description;
        }
    }

    public isEmpty():boolean {
        return !this.translate && !this.suggest;
    }

    /* purge a translate before use it, this will remove outdated informations */
    public purge(mod: Mod) {
        const modContentRef = ModTranslate.toReferenceString(this.getStr(mod));
        if (modContentRef != this.translateRef) {
            this.translate = this.translateRef = null;
        }
        if (modContentRef != this.suggestRef) {
            this.suggest = this.suggestRef = null;
        }
    }

    public applyTo(modApiResponse:ModAPIPublicResponse):ModAPIPublicResponse {
        if (this.translate == null) {
            return modApiResponse;
        }
        
        let translateObj:ModTranslateObject = modApiResponse.translates[this.langCode];
        if (!translateObj) {
            translateObj = modApiResponse.translates[this.langCode] = {};
        }
        switch (this.translateType) {
            case ModTranslateType.Name:
                translateObj.name = this.translate;
                break;
            case ModTranslateType.Summary:
                translateObj.summary = this.translate;
                break;
            case ModTranslateType.Description:
                translateObj.description = this.translate;
                break;
        }
        return modApiResponse;
    }

    public toAPIPublicResponse(): ModTranslateAPIPublicResponse {
        return {
            modId: this.modId,
            langCode: this.langCode,
            translateType: this.translateType,
            translate: this.translate,
            translateRef: this.translateRef,
            suggest: this.suggest,
            suggestRef: this.suggestRef,
            translatorUserIds: this.translatorUserIds,
            suggesterUserIds: this.suggesterUserIds,
            translatorModifiedUserId: this.translatorModifiedUserId,
        };
    }
}