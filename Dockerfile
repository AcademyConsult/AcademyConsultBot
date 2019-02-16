FROM node
MAINTAINER Roman Anasal <roman.anasal@academyconsult.de>

WORKDIR /app/

ARG UID=1000
ARG GID=1000
RUN groupmod -g ${GID} node && usermod -u ${UID} node && chown -R node:node /home/node/ /app/
USER node

COPY package.json package-lock.json /app/
RUN npm install --production

COPY typings/ /app/typings/
COPY *.ts tsconfig.json activedirectory_CA.pem /app/

CMD ["npm", "start"]
