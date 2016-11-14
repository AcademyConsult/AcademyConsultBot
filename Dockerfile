FROM node
MAINTAINER Roman Anasal <roman.anasal@academyconsult.de>

WORKDIR /app/

COPY main.js unifi.js cache.js package.json activedirectory_CA.pem /app/
RUN npm install

CMD ["npm", "start"]
