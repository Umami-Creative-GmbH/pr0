FROM nginx:1.30.6-alpine@sha256:583b7f2fce1cdb8da5ad5c39ebd3c33b98b87d493190e548bdee1fa8c619c311

COPY nginx.conf /etc/nginx/nginx.conf
RUN mkdir -p /srv/update && chown nginx:nginx /srv/update

USER nginx
EXPOSE 8080
ENTRYPOINT ["nginx"]
CMD ["-g", "daemon off;"]
