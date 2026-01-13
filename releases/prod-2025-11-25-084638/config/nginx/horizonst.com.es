
# Redirección HTTP -> HTTPS

server {

    listen 80;

    server_name horizonst.com.es www.horizonst.com.es;

    return 301 https://$host$request_uri;

}



# HTTPS + reverse proxy

server {

    listen 443 ssl http2;

    server_name horizonst.com.es www.horizonst.com.es;



    include /etc/nginx/snippets/cockpit.conf;



    ssl_certificate     /etc/letsencrypt/live/horizonst.com.es/fullchain.pem;

    ssl_certificate_key /etc/letsencrypt/live/horizonst.com.es/privkey.pem;



    include /etc/nginx/snippets/horizonst_security.conf;



    client_max_body_size 25m;

    proxy_read_timeout   300s;

    proxy_connect_timeout 60s;

    proxy_send_timeout   300s;



    proxy_set_header Host              $host;

    proxy_set_header X-Real-IP         $remote_addr;

    proxy_set_header X-Forwarded-For   $proxy_add_x_forwarded_for;

    proxy_set_header X-Forwarded-Proto $scheme;

    proxy_http_version 1.1;



    # --- APP (Web + API) bajo /administracion ---

    # Redirige /administracion -> /administracion/

    location = /administracion { return 301 /administracion/; }



    location ^~ /administracion/ {

        # Pasa al backend y quita el prefijo /administracion/

        proxy_pass http://127.0.0.1:3000/;



        proxy_http_version 1.1;

        proxy_set_header Host $host;

        proxy_set_header X-Real-IP $remote_addr;

        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;

        proxy_set_header X-Forwarded-Proto $scheme;

        proxy_set_header X-Forwarded-Prefix /administracion;



        # WebSockets si la app los usa

        proxy_set_header Upgrade $http_upgrade;

        proxy_set_header Connection "upgrade";



        # Para poder reescribir el HTML (evita compresión)

        proxy_set_header Accept-Encoding "";



        # Reescritura de rutas absolutas en HTML -> /administracion/...

        sub_filter_once off;

        sub_filter_types text/html;

        sub_filter 'href="/'        'href="/administracion/';

        sub_filter 'src="/'         'src="/administracion/';

        sub_filter 'action="/'      'action="/administracion/';

        sub_filter '<base href="/">' '<base href="/administracion/">';



        # (opcional) desactivar buffering si necesitas debug en tiempo real

        # proxy_buffering off;

    }



    # --- RFID Access bajo /elecnor ---

    # Redirige /elecnor -> /elecnor/

    location = /elecnor { return 301 /elecnor/; }



    location ^~ /elecnor/ {

        # Proxy hacia la interfaz HTTP del rfid_access en loopback:3001

        # Nota: la barra final en proxy_pass QUITA el prefijo /elecnor/ al reenviar

        proxy_pass http://127.0.0.1:3001/;



        proxy_http_version 1.1;

        proxy_set_header Host              $host;

        proxy_set_header X-Real-IP         $remote_addr;

        proxy_set_header X-Forwarded-For   $proxy_add_x_forwarded_for;

        proxy_set_header X-Forwarded-Proto $scheme;

        proxy_set_header X-Forwarded-Prefix /elecnor;



        # WebSockets (si aplica)

        proxy_set_header Upgrade $http_upgrade;

        proxy_set_header Connection "upgrade";



        # Si los assets de la interfaz usaran rutas absolutas, activaremos

        # reescritura sub_filter igual que en /administracion (de momento no)

        # proxy_set_header Accept-Encoding "";

        # sub_filter_once off;

        # sub_filter_types text/html;

        # sub_filter 'href="/'        'href="/elecnor/';

        # sub_filter 'src="/'         'src="/elecnor/';

        # sub_filter 'action="/'      'action="/elecnor/';

        # sub_filter '<base href="/">' '<base href="/elecnor/">';

    }



    # --- EMQX Dashboard público en /emqx/ ---

    location ^~ /emqx/ {

        proxy_set_header Upgrade $http_upgrade;

        proxy_set_header Connection "upgrade";

        proxy_pass http://127.0.0.1:18083/;

        proxy_redirect off;

        proxy_buffering off;

    }

    location = /emqx { return 301 /emqx/; }



    # --- pgAdmin público en /pgadmin/ ---

    location ^~ /pgadmin/ {

        proxy_set_header X-Script-Name /pgadmin;

        proxy_set_header X-Forwarded-Prefix /pgadmin;

        proxy_set_header Upgrade $http_upgrade;

        proxy_set_header Connection "upgrade";

        proxy_pass http://127.0.0.1:5050;

        proxy_redirect off;

        proxy_buffering off;

        proxy_read_timeout 300s;

    }

    location = /pgadmin { return 301 /pgadmin/; }



    access_log /var/log/nginx/horizonst.access.log;

    error_log  /var/log/nginx/horizonst.error.log;

}

