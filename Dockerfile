FROM node
MAINTAINER Roman Anasal <roman.anasal@academyconsult.de>

WORKDIR /app/

COPY node_modules /app/node_modules
COPY main.js unifi.js cache.js package.json activedirectory_CA.pem /app/

CMD ["npm", "start"]
