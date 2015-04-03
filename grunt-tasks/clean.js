/**
 * Created by mcsere on 1/9/15.
 */

module.exports = function (grunt) {
    grunt.config('clean', {
        main: ["<%=env.root%>"],
        tmp: ['.tmp'],
        build:['build'],
        css: ['src/static/css']
    });
};