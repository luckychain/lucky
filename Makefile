default: clean make-js ./public/javascripts/bundle.js css

clean:
	if test -d ./public/javascripts/bundle.js; then echo "Did not remove"; else rm -f ./public/javascripts/bundle.js; fi

make-js:
	if test -d ./public/javascripts; then echo "public/javascripts exists"; else mkdir ./public/javascripts; fi

./public/javascripts/bundle.js:
	./node_modules/.bin/browserify -d -t reactify ./src/js/browser-app.js > $@

css:
	cat ./public/stylesheets/styles/*.css > ./public/stylesheets/bundle.css