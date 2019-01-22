FROM node
MAINTAINER Roman Anasal <roman.anasal@academyconsult.de>

WORKDIR /app/

COPY package.json package-lock.json /app/
RUN npm install --production

COPY main.js unifi.js cache.js activedirectory_CA.pem /app/

CMD ["npm", "start"]
