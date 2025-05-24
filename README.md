# Meteorkart

En enkel nettside, som viser meteor-observasjoner i Norge i 2025, ved hjelp av data fra [Norsk Meteornettverk](http://norskmeteornettverk.no). Den er hostet på Vercel på https://meteorkart.vercel.app/.

## Lokal utvikling

Bruk `npm` til å installere nødvendige moduler, så kjør prosjektet:


```
npm i && npm run dev
```

## Kjøre lokalt

Nettsiden kan serves med hvilken som helst webserver.

Først, bygg prosjektet med `npm run build`, så åpne webserver i dist. F.eks. med Python: `cd dist && python3 -m http.server`.