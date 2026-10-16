# Fáze 1 – tři pilíře

Verze: 16.10.2026 · stav: pilíř 1 hotový v kódu, pilíře 2 a 3 v přípravě

| Pilíř | Co koordinátorka udělá | Co aplikace ukáže / udělá | Stav |
|---|---|---|---|
| 1. Hledání | zadá O-ID, S7, telefon nebo jméno | na jedné stránce: MWF (stav, poznámky, historie), e-maily koordinace, události v kalendářích techniků, zprávy v Google Chatu (včetně odpovědí ve vlákně) | hotovo v kódu (`src/zdroje/`, `/hledat`, detail zakázky) |
| 2. Zakázka → technik | zadá ID zakázky | naplánuje ji technikovi (upřesnit: kdo vybírá technika, zápis do kalendáře) | návrh v `src/plan/planovac.ts`, čeká na upřesnění |
| 3. Slot → zakázky | vybere technika a konkrétní time-slot | nabídne zakázky, kterými slot doplnit (plnění kalendáře) | připravuje se |

## Pilíř 1 – zdroje

| Zdroj | Jak se čte | Co se hledá |
|---|---|---|
| MWF | databáze z importu exportů | přesně: ID aktivity, O-ID, S7; volně: telefon, jméno, adresa |
| E-mail | Gmail schránky tmcz01 (zrcadlo skupiny koordinace), posledních 365 dní | „O-…“ OR „S7“ |
| Kalendáře | všechny kalendáře v seznamu tmcz01 (kalendáře techniků), −180 až +90 dní | O-ID, S7 |
| Google Chat | vybrané prostory (`CHAT_PROSTORY`), posledních 120 dní, cache 5 min | O-ID, S7 v textu + odpovědi ve stejném vlákně |

Vše jen ke čtení, jménem `tmcz01@ictmount.com` (delegace v rámci domény, bez klíče – `src/google/delegace.ts`).
Každý zdroj má limit 12 s; výpadek jednoho zdroje ostatní nezastaví.
